/**
 * 強制負け検出の純粋関数
 *
 * worker とテストの両方から利用する SSoT モジュール。
 */

import type { BoardState, Position } from "@/types/game";
import type { ForcedLossResult } from "@/types/review";

import { BOARD_SIZE } from "@/constants/board";

import type { WasmSearchEngine } from "../wasm/searchEngine";

import { detectWhiteWinningPattern } from "../evaluation/winningPatterns";
import {
  VCT_STONE_THRESHOLD,
  type MiseVCFSearchOptions,
  type VCFSearchOptions,
  type VCTSearchOptions,
} from "../search/types";
// #37 P3 PR4/PR5b/PR6: 脅威検出・両ミセ手・VCT検証ヘルパーを Zig 単一ソース経由に（合法局面で TS と一致、未ロード時 TS フォールバック）。
import {
  detectOpponentThreats,
  findDoubleMiseMoves,
  hasFourThreeAvailable,
  hasOpenThree,
} from "../wasm/threatAdapter";
import {
  wasmFindVCFSequence,
  wasmFindMiseVCFSequence,
  wasmFindVCTSequenceStrict,
} from "./wasmAdapters";

/**
 * 振り返り用探索パラメータ
 *
 * 各探索関数は timeLimit 省略時にデフォルト値（150〜500ms）を使うため、
 * 振り返りでは Infinity を明示的に指定して時間制限を無効化する。
 * maxDepth のみで探索範囲を制御する。
 */
const _NO_TIME_LIMIT = Infinity;

/** Phase 1 打たれた手のチェック用 */
export const REVIEW_VCF_OPTIONS: VCFSearchOptions = {
  maxDepth: 16,
  timeLimit: 5_000, // 5秒上限
  maxNodes: 500_000,
};
export const REVIEW_MISE_VCF_OPTIONS: MiseVCFSearchOptions = {
  vcfOptions: { maxDepth: 12, timeLimit: 3_000, maxNodes: 500_000 },
  timeLimit: 5_000,
};

/**
 * Phase 2/3 VCT 深掘りチェック用
 *
 * timeLimit=10,000ms（VCT内部のVCFがノードカウントを共有しないため maxNodes
 * だけでは不十分、という理由での保守的な上限）。
 *
 * #70（2026-07-18）調査時の判断: 当初「予算不足」と推測されていたが、実際の
 * 原因は VCT_STONE_THRESHOLD の石数ゲート（そちらのコメント参照）で、この
 * timeLimit/maxNodes 自体は変更していない。ボス実戦21手の実測では、閾値を
 * 8（危険な陰性探索ゾーンである6-7石を除外）に調整した結果、この21手全体で
 * timeLimit(10秒)に張り付くケースは発生しなくなった（本物の検出は全て
 * 600ms未満）。maxNodes=500,000 を主たる決定的な打ち切り条件として維持し、
 * timeLimit はその補助的な安全上限のままとしている。
 */
export const FORCED_LOSS_VCT_OPTIONS: VCTSearchOptions = {
  maxDepth: 8,
  timeLimit: 10_000,
  maxNodes: 500_000,
  vcfOptions: { maxDepth: 16, timeLimit: 3_000, maxNodes: 100_000 },
  // 被詰タブで防御分岐を木展開するための詰み木を収集する（#26）。
  // Zig の collect-mode は時刻ベース timeLimit (vct.zig:1116/1187) で打ち切るため bulk 完走を阻害しない。
  collectBranches: true,
};

/** 候補手検証用（verifyCandidates / verifyCandidatePVs） */
export const CANDIDATE_VERIFY_VCF_OPTIONS: VCFSearchOptions = {
  maxDepth: 12,
  timeLimit: 1000,
  maxNodes: 500_000, // 爆発防止
};
export const CANDIDATE_VERIFY_MISE_VCF_OPTIONS: MiseVCFSearchOptions = {
  vcfOptions: { maxDepth: 12, timeLimit: 1000, maxNodes: 500_000 },
  timeLimit: 1000,
};
export const CANDIDATE_VERIFY_VCT_OPTIONS: VCTSearchOptions = {
  maxDepth: 4,
  timeLimit: 2000,
  maxNodes: 100_000, // 50Kでは検出漏れ発生のため100Kに据え置き
  vcfOptions: { maxDepth: 12, timeLimit: 1000, maxNodes: 500_000 },
  collectBranches: false,
};

export interface ForcedLossCheckOptions {
  vcfOptions: VCFSearchOptions;
  miseVcfOptions: MiseVCFSearchOptions;
  vctOptions: VCTSearchOptions;
  skipVCT?: boolean;
}

interface WhiteWinningMoves {
  doubleFour?: Position;
  doubleThree?: Position;
}

/**
 * 白の四四・三三手を全空きセルから1パスでスキャンして収集する
 *
 * 四四と三三を別々の優先レベルで使うため、それぞれ最初の1手ずつ返す。
 */
function findWhiteWinningMoves(board: BoardState): WhiteWinningMoves {
  const result: WhiteWinningMoves = {};
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = board[r];
    if (!row) {
      continue;
    }
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (row[c] !== null) {
        continue;
      }
      row[c] = "white";
      const type = detectWhiteWinningPattern(board, r, c);
      if (type === "double-four" && !result.doubleFour) {
        result.doubleFour = { row: r, col: c };
      } else if (type === "double-three" && !result.doubleThree) {
        result.doubleThree = { row: r, col: c };
      }
      if (result.doubleFour && result.doubleThree) {
        row[c] = null;
        return result;
      }
      row[c] = null;
    }
  }
  return result;
}

/**
 * 相手の必勝手順（VCF→Mise-VCF→VCT）を検出する
 *
 * 脅威優先度と防御条件の対応:
 * | 優先度 | 脅威タイプ | カウンター脅威条件          | 処理方式       |
 * | 1      | VCF       | カウンター四（探索内部）      | 探索内部       |
 * | 2      | 四四      | 四/活四（L1ガード）          | L1で全スキップ |
 * | 3      | 両ミセ    | 活三 or ミセ手               | 外部フィルタ   |
 * | 4      | Mise-VCF  | 活三 or ミセ手               | エントリーガード|
 * | 5      | 三三      | 活三 or ミセ手               | 外部フィルタ   |
 * | 6      | VCT       | 活三(per-node) + ct分岐      | 探索内部       |
 */
export function checkForcedLoss(
  boardAfter: BoardState,
  opponentColor: "black" | "white",
  stoneCountAfter: number,
  wasmSearchEngine: WasmSearchEngine,
  options?: ForcedLossCheckOptions,
): ForcedLossResult | undefined {
  const vcfOpts = options?.vcfOptions ?? REVIEW_VCF_OPTIONS;
  const miseOpts = options?.miseVcfOptions ?? REVIEW_MISE_VCF_OPTIONS;
  const vctOpts = options?.vctOptions ?? FORCED_LOSS_VCT_OPTIONS;

  // 0. 白パターンの事前スキャン（高速、結果は後段で使用）
  const whiteWins =
    opponentColor === "white" ? findWhiteWinningMoves(boardAfter) : undefined;

  // 1. VCF（最優先: 四追いで確定した手順）
  const oppVCF = wasmFindVCFSequence(
    wasmSearchEngine,
    boardAfter,
    opponentColor,
    vcfOpts,
  );
  if (oppVCF) {
    return {
      type: oppVCF.isForbiddenTrap ? "forbidden-trap" : "vcf",
      sequence: oppVCF.sequence,
    };
  }

  // 2. 四四（VCFが時間切れ等で見逃した場合のフォールバック）
  if (whiteWins?.doubleFour) {
    return { type: "double-four", sequence: [whiteWins.doubleFour] };
  }

  // フクミ手チェック: プレイヤーにVCFがあるか
  // VCF（四追い）は三ベースの脅威（両ミセ・Mise-VCF・三三）より優先するため、
  // プレイヤーがVCFを持っている場合、相手の三ベース脅威が
  // VCFも同時に阻止していない限り無効化される
  const playerColor: "black" | "white" =
    opponentColor === "black" ? "white" : "black";
  const playerVCF = wasmFindVCFSequence(
    wasmSearchEngine,
    boardAfter,
    playerColor,
    vcfOpts,
  );

  // 3. 両ミセ（防御側に活三がある場合は不成立）
  const validDM = filterByCounterThreats(
    boardAfter,
    opponentColor,
    findDoubleMiseMoves(boardAfter, opponentColor),
  );
  if (validDM.length > 0 && validDM[0]) {
    if (
      !playerVCF ||
      !retainsVCFAfterOpponentMove(
        boardAfter,
        validDM[0],
        opponentColor,
        playerColor,
        wasmSearchEngine,
        vcfOpts,
      )
    ) {
      return { type: "double-mise", sequence: [validDM[0]] };
    }
  }

  // 4. Mise-VCF
  const oppMise = wasmFindMiseVCFSequence(
    wasmSearchEngine,
    boardAfter,
    opponentColor,
    miseOpts,
  );
  if (oppMise) {
    const [miseFirstMove] = oppMise.sequence;
    if (
      !playerVCF ||
      !miseFirstMove ||
      !retainsVCFAfterOpponentMove(
        boardAfter,
        miseFirstMove,
        opponentColor,
        playerColor,
        wasmSearchEngine,
        vcfOpts,
      )
    ) {
      return { type: "mise-vcf", sequence: oppMise.sequence };
    }
  }

  // 5. 三三（VCTと同等レベル、防御側に活三がある場合は不成立）
  if (whiteWins?.doubleThree) {
    const validDT = filterByCounterThreats(boardAfter, opponentColor, [
      whiteWins.doubleThree,
    ]);
    if (validDT.length > 0 && validDT[0]) {
      if (
        !playerVCF ||
        !retainsVCFAfterOpponentMove(
          boardAfter,
          validDT[0],
          opponentColor,
          playerColor,
          wasmSearchEngine,
          vcfOpts,
        )
      ) {
        return { type: "double-three", sequence: [validDT[0]] };
      }
    }
  }

  // 6. VCT（被詰み判定なので strict: カウンターフォーでテンポを奪い返される
  // 手順=幻の被詰みを棄却する。攻めの forcedWin 検出とは非対称なので lenient は使わない）
  if (!options?.skipVCT) {
    const oppVCT = wasmFindVCTSequenceStrict(
      wasmSearchEngine,
      boardAfter,
      opponentColor,
      vctOpts,
    );
    if (oppVCT) {
      return {
        type: oppVCT.isForbiddenTrap ? "forbidden-trap" : "vct",
        sequence: oppVCT.sequence,
        tree: oppVCT.tree,
      };
    }
  }

  return undefined;
}

/**
 * Phase 2/3: 相手のVCTのみを判定する（vctCheckOnly 用。review.worker.ts と
 * テストの両方から利用する SSoT）
 *
 * checkForcedLoss の VCT ステップ（#6）と異なり、こちらは以下の呼び出し条件を
 * 追加で持つ:
 * - 自分（color）に四/活四があれば相手はVCT不可のため即 undefined
 * - 石数が VCT_STONE_THRESHOLD 未満の局面は、探索コストに見合わないため
 *   スキップする（#70: 旧14は開局直後の陰性探索が高コストという想定だったが、
 *   J6の実例のように8石時点で本物の被詰みが存在するケースを見逃していた。
 *   skipStoneThreshold=true で無視可能。Phase 3 遡及チェック用）
 */
export function checkForcedLossVCTOnly(
  boardAfter: BoardState,
  color: "black" | "white",
  opponentColor: "black" | "white",
  stoneCountAfter: number,
  wasmSearchEngine: WasmSearchEngine,
  options?: { vctOptions?: VCTSearchOptions; skipStoneThreshold?: boolean },
): ForcedLossResult | undefined {
  const selfThreats = detectOpponentThreats(boardAfter, color);
  const selfHasFour =
    selfThreats.fours.length > 0 || selfThreats.openFours.length > 0;
  if (selfHasFour) {
    return undefined;
  }
  if (!options?.skipStoneThreshold && stoneCountAfter < VCT_STONE_THRESHOLD) {
    return undefined;
  }

  const vctOpts = options?.vctOptions ?? FORCED_LOSS_VCT_OPTIONS;
  // 被詰み判定なので strict（幻の被詰みを棄却。checkForcedLoss と同じ理由）
  const oppVCT = wasmFindVCTSequenceStrict(
    wasmSearchEngine,
    boardAfter,
    opponentColor,
    vctOpts,
  );
  if (!oppVCT) {
    return undefined;
  }
  return {
    type: oppVCT.isForbiddenTrap ? "forbidden-trap" : "vct",
    sequence: oppVCT.sequence,
    tree: oppVCT.tree,
  };
}

/**
 * 相手の脅威手を仮配置した後もプレイヤーにVCFが残るかチェック
 *
 * フクミ手（プレイヤーにVCF）がある場合、相手の三ベース脅威（三三・両ミセ等）は
 * その脅威手がVCFも同時に阻止していない限り無効化される。
 * 四追い（VCF）は三より優先するため、プレイヤーは三を無視してVCFを実行できる。
 */
function retainsVCFAfterOpponentMove(
  board: BoardState,
  opponentMove: Position,
  opponentColor: "black" | "white",
  playerColor: "black" | "white",
  wasmSearchEngine: WasmSearchEngine,
  vcfOpts: VCFSearchOptions,
): boolean {
  const row = board[opponentMove.row];
  if (!row) {
    return false;
  }

  row[opponentMove.col] = opponentColor;
  try {
    const vcf = wasmFindVCFSequence(
      wasmSearchEngine,
      board,
      playerColor,
      vcfOpts,
    );
    return vcf !== null;
  } finally {
    row[opponentMove.col] = null;
  }
}

/**
 * 候補手を仮配置して相手の強制勝ちを検出する
 */
export function checkCandidateForcedLoss(
  board: BoardState,
  pos: Position,
  color: "black" | "white",
  opponentColor: "black" | "white",
  stoneCount: number,
  wasmSearchEngine: WasmSearchEngine,
  options?: ForcedLossCheckOptions,
): ForcedLossResult | undefined {
  const row = board[pos.row];
  if (!row) {
    return undefined;
  }

  row[pos.col] = color;
  try {
    // L1ガード: 自分に四/活四があれば相手の全脅威をスキップ
    // （四を止めなければ即負けのため、相手はVCF/VCT/両ミセ等を実行できない）
    // L2（個別脅威の活三/ミセ手チェック）は各探索関数・filterByCounterThreats で処理
    const selfThreats = detectOpponentThreats(board, color);
    if (selfThreats.fours.length > 0 || selfThreats.openFours.length > 0) {
      return undefined;
    }
    return checkForcedLoss(
      board,
      opponentColor,
      stoneCount + 1,
      wasmSearchEngine,
      options,
    );
  } finally {
    row[pos.col] = null;
  }
}

/**
 * 相手に反撃脅威（活三またはミセ手）がある場合に無効な候補手を除外する
 *
 * 両ミセ・三三など「次に四三を作る」系の脅威は、相手に活三やミセ手があると
 * 相手は防御を無視して棒四や四三を打てるため成立しない。
 * ただし、候補手が同時に相手の脅威をブロックする場合は有効。
 */
export function filterByCounterThreats(
  board: BoardState,
  attackerColor: "black" | "white",
  candidates: Position[],
): Position[] {
  if (candidates.length === 0) {
    return candidates;
  }
  const defenderColor = attackerColor === "black" ? "white" : "black";
  if (
    !hasOpenThree(board, defenderColor) &&
    !hasFourThreeAvailable(board, defenderColor)
  ) {
    return candidates;
  }
  return candidates.filter((move) => {
    const row = board[move.row];
    if (!row) {
      return false;
    }
    row[move.col] = attackerColor;
    const valid =
      !hasOpenThree(board, defenderColor) &&
      !hasFourThreeAvailable(board, defenderColor);
    row[move.col] = null;
    return valid;
  });
}
