/**
 * 振り返り評価ロジック
 *
 * スコア差に基づく手の品質分類と精度計算
 */

import type { Position, StoneColor } from "@/types/game";
import type {
  EvaluatedMove,
  FullEvalResult,
  GameReview,
  LightEvalResult,
  MoveQuality,
  VCTCheckResult,
} from "@/types/review";

import { parseGameRecord } from "@/logic/gameRecordParser";

/** 珠型（開局）の手数。評価対象外 */
export const OPENING_MOVES = 3;

/**
 * 開局手かどうかを判定
 */
export function isOpeningMove(moveIndex: number): boolean {
  return moveIndex < OPENING_MOVES;
}

/**
 * スコア差に基づく品質分類
 */
export function classifyMoveQuality(scoreDiff: number): MoveQuality {
  const absDiff = Math.abs(scoreDiff);
  if (absDiff === 0) {
    return "excellent";
  }
  if (absDiff <= 80) {
    return "good";
  }
  if (absDiff <= 300) {
    return "inaccuracy";
  }
  if (absDiff <= 1000) {
    return "mistake";
  }
  return "blunder";
}

/**
 * Worker結果から評価済みの手を構築
 *
 * FullEvalResult または LightEvalResult を受け付ける。
 * VCTCheckResult は applyVCTResult で既存の EvaluatedMove にマージする。
 *
 * @param parsedMoves パース済み手順配列（省略時はmoveHistoryからパース）
 * @param analyzeAll 全手分析モード（全手をisPlayerMove: trueに）
 */
export function buildEvaluatedMove(
  result: FullEvalResult | LightEvalResult,
  moveHistoryOrMoves: string | { position: Position; color: StoneColor }[],
  playerFirst: boolean,
  analyzeAll?: boolean,
): EvaluatedMove {
  const moves =
    typeof moveHistoryOrMoves === "string"
      ? parseGameRecord(moveHistoryOrMoves)
      : moveHistoryOrMoves;
  const move = moves[result.moveIndex];
  const isPlayerMove =
    analyzeAll ||
    (playerFirst ? result.moveIndex % 2 === 0 : result.moveIndex % 2 === 1);

  if (result.mode === "lightEval") {
    return {
      moveIndex: result.moveIndex,
      position: move?.position ?? { row: 7, col: 7 },
      isPlayerMove,
      quality: "excellent",
      playedScore: 0,
      bestScore: 0,
      scoreDiff: 0,
      bestMove: result.bestMove,
      candidates: [],
      forcedWinType: result.forcedWinType,
      isLightEval: true,
    };
  }

  const scoreDiff = result.bestScore - result.playedScore;

  let quality = classifyMoveQuality(scoreDiff);
  if (quality === "excellent" && result.missedDoubleMise?.length) {
    quality = "good";
  }

  return {
    moveIndex: result.moveIndex,
    position: move?.position ?? { row: 7, col: 7 },
    isPlayerMove,
    quality,
    playedScore: result.playedScore,
    bestScore: result.bestScore,
    scoreDiff,
    bestMove: result.bestMove,
    candidates: result.candidates,
    completedDepth: result.completedDepth,
    forcedWinType: result.forcedWinType,
    forcedWinBranches: result.forcedWinBranches,
    forcedLossType: result.forcedLossType,
    forcedLossSequence: result.forcedLossSequence,
    missedDoubleMise: result.missedDoubleMise,
    doubleMiseTargets: result.doubleMiseTargets,
  };
}

/**
 * VCTチェック結果を既存の EvaluatedMove にマージする
 */
export function applyVCTResult(
  existing: EvaluatedMove,
  result: VCTCheckResult,
): EvaluatedMove {
  if (!result.forcedLossType) {
    return existing;
  }
  return {
    ...existing,
    forcedLossType: result.forcedLossType,
    forcedLossSequence: result.forcedLossSequence,
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
      return "#f44336";
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
      return "悪手";
    default: {
      const _exhaustive: never = quality;
      return _exhaustive;
    }
  }
}
