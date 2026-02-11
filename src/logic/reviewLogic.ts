/**
 * 振り返り評価ロジック
 *
 * スコア差に基づく手の品質分類と精度計算
 */

import type {
  EvaluatedMove,
  GameReview,
  MoveQuality,
  ReviewWorkerResult,
} from "@/types/review";

import { parseGameRecord } from "@/logic/gameRecordParser";

/**
 * スコア差に基づく品質分類
 */
export function classifyMoveQuality(scoreDiff: number): MoveQuality {
  const absDiff = Math.abs(scoreDiff);
  if (absDiff <= 50) {
    return "excellent";
  }
  if (absDiff <= 200) {
    return "good";
  }
  if (absDiff <= 500) {
    return "inaccuracy";
  }
  if (absDiff <= 1500) {
    return "mistake";
  }
  return "blunder";
}

/**
 * Worker結果から評価済みの手を構築
 */
export function buildEvaluatedMove(
  result: ReviewWorkerResult,
  moveHistory: string,
  playerFirst: boolean,
): EvaluatedMove {
  const moves = parseGameRecord(moveHistory);
  const move = moves[result.moveIndex];
  const isPlayerMove = playerFirst
    ? result.moveIndex % 2 === 0
    : result.moveIndex % 2 === 1;

  const scoreDiff = result.bestScore - result.playedScore;

  return {
    moveIndex: result.moveIndex,
    position: move?.position ?? { row: 7, col: 7 },
    isPlayerMove,
    quality: classifyMoveQuality(scoreDiff),
    playedScore: result.playedScore,
    bestScore: result.bestScore,
    scoreDiff,
    bestMove: result.bestMove,
    candidates: result.candidates,
    completedDepth: result.completedDepth,
    forcedWinType: result.forcedWinType,
    forcedWinBranches: result.forcedWinBranches,
  };
}

/**
 * 全手の評価結果から対局全体の評価を構築
 */
export function buildGameReview(evaluatedMoves: EvaluatedMove[]): GameReview {
  const playerMoves = evaluatedMoves.filter((m) => m.isPlayerMove);

  // 精度計算: excellentとgoodの割合
  const goodOrBetter = playerMoves.filter(
    (m) => m.quality === "excellent" || m.quality === "good",
  ).length;
  const accuracy =
    playerMoves.length > 0
      ? Math.round((goodOrBetter / playerMoves.length) * 100)
      : 100;

  // クリティカルエラー数
  const criticalErrors = playerMoves.filter(
    (m) => m.quality === "mistake" || m.quality === "blunder",
  ).length;

  return {
    evaluatedMoves,
    accuracy,
    criticalErrors,
  };
}

/**
 * 品質に対応する色を取得
 */
export function getQualityColor(quality: MoveQuality): string {
  switch (quality) {
    case "excellent":
      return "#00bcd4";
    case "good":
      return "#4caf50";
    case "inaccuracy":
      return "#ff9800";
    case "mistake":
      return "#f44336";
    case "blunder":
      return "#b71c1c";
    default: {
      const _exhaustive: never = quality;
      return _exhaustive;
    }
  }
}

/**
 * 品質に対応するラベルを取得
 */
export function getQualityLabel(quality: MoveQuality): string {
  switch (quality) {
    case "excellent":
      return "最善手";
    case "good":
      return "好手";
    case "inaccuracy":
      return "疑問手";
    case "mistake":
      return "悪手";
    case "blunder":
      return "大悪手";
    default: {
      const _exhaustive: never = quality;
      return _exhaustive;
    }
  }
}
