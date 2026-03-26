/**
 * 強制負け検出の純粋関数
 *
 * worker とテストの両方から利用する SSoT モジュール。
 */

import type { BoardState, Position } from "@/types/game";
import type { ForcedLossResult } from "@/types/review";

import { BOARD_SIZE } from "@/constants/board";

import { detectOpponentThreats } from "../evaluation";
import { findDoubleMiseMoves } from "../evaluation/tactics";
import { detectWhiteWinningPattern } from "../evaluation/winningPatterns";
import {
  findMiseVCFSequence,
  type MiseVCFSearchOptions,
} from "../search/miseVcf";
import { findVCFSequence, type VCFSearchOptions } from "../search/vcf";
import {
  findVCTSequence,
  VCT_STONE_THRESHOLD,
  type VCTSearchOptions,
} from "../search/vct";
import { hasFourThreeAvailable, hasOpenThree } from "../search/vctHelpers";

/**
 * 振り返り用探索パラメータ
 *
 * 各探索関数は timeLimit 省略時にデフォルト値（150〜500ms）を使うため、
 * 振り返りでは Infinity を明示的に指定して時間制限を無効化する。
 * maxDepth のみで探索範囲を制御する。
 */
const NO_TIME_LIMIT = Infinity;

/** Phase 1 打たれた手のチェック用 */
export const REVIEW_VCF_OPTIONS: VCFSearchOptions = {
  maxDepth: 16,
  timeLimit: NO_TIME_LIMIT,
};
export const REVIEW_MISE_VCF_OPTIONS: MiseVCFSearchOptions = {
  vcfOptions: { maxDepth: 12, timeLimit: NO_TIME_LIMIT },
  timeLimit: NO_TIME_LIMIT,
};

/** Phase 2/3 VCT 深掘りチェック用 */
export const FORCED_LOSS_VCT_OPTIONS: VCTSearchOptions = {
  maxDepth: 8,
  timeLimit: NO_TIME_LIMIT,
  maxNodes: 500_000, // globalTT.clear() で TT キャッシュなしでも完了を保証
  vcfOptions: { maxDepth: 16, timeLimit: NO_TIME_LIMIT },
  collectBranches: false,
};

/** 候補手検証用（verifyCandidates / verifyCandidatePVs） */
export const CANDIDATE_VERIFY_VCF_OPTIONS: VCFSearchOptions = {
  maxDepth: 12,
  timeLimit: NO_TIME_LIMIT,
};
export const CANDIDATE_VERIFY_MISE_VCF_OPTIONS: MiseVCFSearchOptions = {
  vcfOptions: { maxDepth: 12, timeLimit: NO_TIME_LIMIT },
  timeLimit: NO_TIME_LIMIT,
};
export const CANDIDATE_VERIFY_VCT_OPTIONS: VCTSearchOptions = {
  maxDepth: 4,
  timeLimit: NO_TIME_LIMIT,
  maxNodes: 100_000, // globalTT.clear() で TT キャッシュなしでも完了を保証
  vcfOptions: { maxDepth: 12, timeLimit: NO_TIME_LIMIT },
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
  options?: ForcedLossCheckOptions,
): ForcedLossResult | undefined {
  const vcfOpts = options?.vcfOptions ?? REVIEW_VCF_OPTIONS;
  const miseOpts = options?.miseVcfOptions ?? REVIEW_MISE_VCF_OPTIONS;
  const vctOpts = options?.vctOptions ?? FORCED_LOSS_VCT_OPTIONS;

  // 0. 白パターンの事前スキャン（高速、結果は後段で使用）
  const whiteWins =
    opponentColor === "white" ? findWhiteWinningMoves(boardAfter) : undefined;

  // 1. VCF（最優先: 四追いで確定した手順）
  const oppVCF = findVCFSequence(boardAfter, opponentColor, vcfOpts);
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

  // 3. 両ミセ（防御側に活三がある場合は不成立）
  const validDM = filterByCounterThreats(
    boardAfter,
    opponentColor,
    findDoubleMiseMoves(boardAfter, opponentColor),
  );
  if (validDM.length > 0 && validDM[0]) {
    return { type: "double-mise", sequence: [validDM[0]] };
  }

  // 4. Mise-VCF
  const oppMise = findMiseVCFSequence(boardAfter, opponentColor, miseOpts);
  if (oppMise) {
    return { type: "mise-vcf", sequence: oppMise.sequence };
  }

  // 5. 三三（VCTと同等レベル、防御側に活三がある場合は不成立）
  if (whiteWins?.doubleThree) {
    const validDT = filterByCounterThreats(boardAfter, opponentColor, [
      whiteWins.doubleThree,
    ]);
    if (validDT.length > 0 && validDT[0]) {
      return { type: "double-three", sequence: [validDT[0]] };
    }
  }

  // 6. VCT
  if (stoneCountAfter >= VCT_STONE_THRESHOLD && !options?.skipVCT) {
    const oppVCT = findVCTSequence(boardAfter, opponentColor, vctOpts);
    if (oppVCT) {
      return {
        type: oppVCT.isForbiddenTrap ? "forbidden-trap" : "vct",
        sequence: oppVCT.sequence,
      };
    }
  }

  return undefined;
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
    return checkForcedLoss(board, opponentColor, stoneCount + 1, options);
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
