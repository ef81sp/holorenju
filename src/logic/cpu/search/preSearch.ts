/**
 * 事前チェック（探索より優先）
 *
 * 緊急タイムアウト → 即勝ち → 必須防御 → 強制勝ち探索 → 候補手制限
 * の順にチェックし、即座に返すべき手や候補手の制限を決定する。
 */

import type { BoardState, Position } from "@/types/game";

import type { SearchContext } from "./context";

import { checkForbiddenMoveWithCache } from "../cache/forbiddenCache";
import { countStones, getOppositeColor } from "../core/boardUtils";
import {
  type EvaluationOptions,
  PATTERN_SCORES,
  type ThreatInfo,
} from "../evaluation/patternScores";
import { detectOpponentThreats } from "../evaluation/threatDetection";
import { detectOpponentThreatsFast } from "../evaluation/threatDetectionFast";
import { generateSortedMoves } from "../moveGenerator";
import { findMiseVCFMove } from "./miseVcf";
import {
  findFourMoves,
  findWinningMove,
  getFourDefensePosition,
} from "./threatPatterns";
import { findVCFSequence, type VCFSequenceResult } from "./vcf";
import { findVCTMove, VCT_STONE_THRESHOLD } from "./vct";
import { hasFourThreeAvailable } from "./vctHelpers";

/**
 * 事前チェック結果
 */
export interface PreSearchResult {
  /** 即座に返すべき手（勝利手・必須防御手） */
  immediateMove?: { position: Position; score: number };
  /** 候補手の制限セット（VCF防御・活三防御） */
  restrictedMoves?: Position[];
  /** 相手VCFの初手（VCF防御用） */
  opponentVCFFirstMove?: Position | null;
  /** VCTヒント手（偽陽性の可能性があるためminimax検証に委ねる） */
  vctHintMove?: Position;
  /** 活三防御の候補手（相手の活三を止める位置） */
  openThreeDefenseMoves?: Position[];
  /** 事前計算済み脅威情報（sortMoves での再利用用） */
  threats?: ThreatInfo;
}

// =========================================================================
// findPreSearchMove サブ関数群
// =========================================================================

/** 絶対時間制限超過時の緊急フォールバック */
function checkEmergencyTimeout(
  board: BoardState,
  color: "black" | "white",
  ctx: SearchContext,
  evaluationOptions: EvaluationOptions,
  absoluteDeadline: number,
): PreSearchResult | null {
  if (performance.now() < absoluteDeadline) {
    return null;
  }
  const { moves } = generateSortedMoves(board, color, {
    ttMove: null,
    killers: ctx.killers,
    depth: 1,
    history: ctx.history,
    useStaticEval: true,
    evaluationOptions,
    maxStaticEvalCount: 5,
  });
  const fallbackMove = moves[0] ?? { row: 7, col: 7 };
  return { immediateMove: { position: fallbackMove, score: 0 } };
}

/** 即勝ち手（五連完成）の検出 */
function checkImmediateWin(
  board: BoardState,
  color: "black" | "white",
): PreSearchResult | null {
  const winMove = findWinningMove(board, color);
  if (!winMove) {
    return null;
  }
  return {
    immediateMove: { position: winMove, score: PATTERN_SCORES.FIVE },
  };
}

/**
 * 相手の活四・止め四に対する必須防御
 *
 * 黒番で防御位置が禁手の場合は null を返し、通常探索に委ねる。
 */
function checkMustDefend(
  board: BoardState,
  color: "black" | "white",
  threats: ThreatInfo,
): PreSearchResult | null {
  // 相手の活四があれば止める（実際には止められないが）
  if (threats.openFours.length > 0) {
    const [defensePos] = threats.openFours;
    if (defensePos) {
      const result = tryDefenseMove(
        board,
        color,
        defensePos,
        -PATTERN_SCORES.FIVE,
      );
      if (result) {
        return result;
      }
    }
  }

  // 相手の止め四があれば止める（止めないと負け）
  // 四三の場合も、まず四を止める（どうせ負けだが）
  if (threats.fours.length > 0) {
    const [defensePos] = threats.fours;
    if (defensePos) {
      const fourDefenseScore =
        threats.openThrees.length > 0 ? -PATTERN_SCORES.FIVE : 0;
      const result = tryDefenseMove(board, color, defensePos, fourDefenseScore);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

/** 防御手を返す。黒番で防御位置が禁手の場合は null（通常探索に委ねる） */
function tryDefenseMove(
  board: BoardState,
  color: "black" | "white",
  defensePos: Position,
  score: number,
): PreSearchResult | null {
  if (color === "black") {
    const { isForbidden } = checkForbiddenMoveWithCache(
      board,
      defensePos.row,
      defensePos.col,
    );
    if (isForbidden) {
      return null;
    } // 禁手追い込み: 通常探索で禁手以外の手を選ぶ
  }
  return { immediateMove: { position: defensePos, score } };
}

/** checkForcedWinSequences の戻り値 */
interface ForcedWinCheckResult {
  immediateMove?: { position: Position; score: number };
  opponentVCFResult: VCFSequenceResult | null;
  vctHintMove?: Position;
}

/**
 * VCF・Mise-VCF・VCTの強制勝ち探索
 *
 * 自VCF → 相手VCF（Mise-VCFスキップ判定用） → Mise-VCF → VCTヒント の順に探索。
 */
function checkForcedWinSequences(
  board: BoardState,
  color: "black" | "white",
  opponentColor: "black" | "white",
  evaluationOptions: EvaluationOptions,
  noTimeLimit: boolean,
): ForcedWinCheckResult {
  // noTimeLimit: 振り返りパスでは performance.now() 依存を排除し決定論的に動作
  // maxNodes は元の timeLimit で探索される典型的なノード数に合わせる
  const vcfOpts = noTimeLimit
    ? { timeLimit: Infinity, maxNodes: 5_000 } // ~150ms equiv
    : undefined;
  const oppVcfOpts = noTimeLimit
    ? { timeLimit: Infinity, maxNodes: 3_000 } // ~100ms equiv
    : { timeLimit: 100 };

  // 自VCF（四追い勝ち）
  // 相手の四がある場合は checkMustDefend で即return済みなのでここには到達しない
  const vcfResult = findVCFSequence(board, color, vcfOpts);
  if (vcfResult) {
    return {
      immediateMove: {
        position: vcfResult.firstMove,
        score: PATTERN_SCORES.FIVE,
      },
      opponentVCFResult: null,
    };
  }

  // 相手VCF（Mise-VCFスキップ判定 + 防御候補制限で共有）
  const opponentVCFResult =
    findVCFSequence(board, opponentColor, oppVcfOpts) ?? null;

  // VCTヒント
  let vctHintMove: Position | undefined = undefined;

  // Mise-VCF（ミセ→強制応手→VCF勝ち）
  // 相手VCFがある場合は間に合わないのでスキップ
  // 相手に四三が作れる場合も、ミセの強制応手の前提が崩れるためスキップ
  if (!opponentVCFResult && !hasFourThreeAvailable(board, opponentColor)) {
    const miseVcfMove = findMiseVCFMove(
      board,
      color,
      noTimeLimit
        ? {
            vcfOptions: { maxDepth: 12, timeLimit: Infinity, maxNodes: 5_000 }, // ~300ms equiv
            timeLimit: Infinity,
          }
        : { vcfOptions: { maxDepth: 12, timeLimit: 300 }, timeLimit: 500 },
    );
    if (miseVcfMove) {
      const isForbidden =
        color === "black" &&
        checkForbiddenMoveWithCache(board, miseVcfMove.row, miseVcfMove.col)
          .isForbidden;
      if (!isForbidden) {
        return {
          immediateMove: {
            position: miseVcfMove,
            score: PATTERN_SCORES.FIVE,
          },
          opponentVCFResult: null,
        };
      }
    }
  }
  if (evaluationOptions.enableVCT) {
    const stoneCount = countStones(board);
    if (stoneCount >= VCT_STONE_THRESHOLD) {
      const vctMove = findVCTMove(board, color, {
        maxDepth: 4,
        timeLimit: noTimeLimit ? Infinity : 150,
        maxNodes: noTimeLimit ? 10_000 : undefined, // ~150ms equiv（VCTはVCFより探索空間が広い）
      });
      if (vctMove) {
        const isForbidden =
          color === "black" &&
          checkForbiddenMoveWithCache(board, vctMove.row, vctMove.col)
            .isForbidden;
        if (!isForbidden) {
          vctHintMove = vctMove;
        }
      }
    }
  }

  return { opponentVCFResult, vctHintMove };
}

/** 相手VCFに対する候補手制限（カウンターフォー + ブロック） */
function computeVCFDefenseMoves(
  board: BoardState,
  color: "black" | "white",
  opponentColor: "black" | "white",
  opponentVCFMove: Position,
): Position[] {
  const defenseSet = new Set<string>();

  // (a) カウンターフォー: 自分の四を作れる手（相手はVCFを中断して応手が必要）
  for (const m of findFourMoves(board, color)) {
    defenseSet.add(`${m.row},${m.col}`);
  }

  // (b) ブロック: 相手VCF開始手をシミュレートし、四の防御位置を取得
  const vcfRow = board[opponentVCFMove.row];
  if (vcfRow) {
    vcfRow[opponentVCFMove.col] = opponentColor;
    const blockPos = getFourDefensePosition(
      board,
      opponentVCFMove,
      opponentColor,
    );
    vcfRow[opponentVCFMove.col] = null;
    if (blockPos) {
      defenseSet.add(`${blockPos.row},${blockPos.col}`);
    }
  }

  return Array.from(defenseSet).map((key) => {
    const [row, col] = key.split(",").map(Number);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return { row: row!, col: col! };
  });
}

// =========================================================================
// findPreSearchMove パイプライン
// =========================================================================

/**
 * 必須手の事前チェック（探索より優先）
 *
 * 緊急タイムアウト → 即勝ち → 必須防御 → 強制勝ち探索 → 候補手制限
 * の順にチェックし、即座に返すべき手や候補手の制限を決定する。
 */
export function findPreSearchMove(
  board: BoardState,
  color: "black" | "white",
  ctx: SearchContext,
  evaluationOptions: EvaluationOptions,
  absoluteDeadline: number,
  noTimeLimit = false,
): PreSearchResult {
  const timeout = checkEmergencyTimeout(
    board,
    color,
    ctx,
    evaluationOptions,
    absoluteDeadline,
  );
  if (timeout) {
    return timeout;
  }

  const win = checkImmediateWin(board, color);
  if (win) {
    return win;
  }

  const opponentColor = getOppositeColor(color);
  const threats = ctx.lineTable
    ? detectOpponentThreatsFast(board, opponentColor, ctx.lineTable)
    : detectOpponentThreats(board, opponentColor);

  const defense = checkMustDefend(board, color, threats);
  if (defense) {
    return defense;
  }

  const forced = checkForcedWinSequences(
    board,
    color,
    opponentColor,
    evaluationOptions,
    noTimeLimit,
  );
  if (forced.immediateMove) {
    return { immediateMove: forced.immediateMove };
  }

  const opponentVCFMove = forced.opponentVCFResult?.firstMove;
  return {
    opponentVCFFirstMove: opponentVCFMove ?? null,
    vctHintMove: forced.vctHintMove,
    // 防御VCFフィルタはベンチマークで弱体化要因と判明（Elo +60.7）のため無効化
    openThreeDefenseMoves: threats.openThrees,
    restrictedMoves: opponentVCFMove
      ? computeVCFDefenseMoves(board, color, opponentColor, opponentVCFMove)
      : undefined,
    threats,
  };
}
