/**
 * 盤面評価関数 - バレルモジュール
 *
 * 評価関数群の公開API。各サブモジュールからre-exportする。
 *
 * ホットパス（minimax等）では直接サブモジュールからimportすることを推奨:
 *   import { evaluatePosition } from "./evaluation/positionEvaluation";
 *   import { evaluateBoard } from "./evaluation/boardEvaluation";
 */

// Re-export: patternScores（型・定数）
export {
  type BoardEvaluationBreakdown,
  DEFAULT_EVAL_OPTIONS,
  type EvaluationOptions,
  FULL_EVAL_OPTIONS,
  type LeafEvaluationOptions,
  type LeafPatternScores,
  type PatternBreakdown,
  PATTERN_SCORES,
  type PatternScoreDetail,
  type ScoreBreakdown,
  type ThreatInfo,
} from "./patternScores";

// Re-export: threatDetection
export { detectOpponentThreats } from "./threatDetection";

// Re-export: stonePatterns
export {
  evaluateStonePatterns,
  evaluateStonePatternsWithBreakdown,
} from "./stonePatterns";

// Re-export: positionEvaluation
export {
  evaluatePosition,
  evaluatePositionWithBreakdown,
} from "./positionEvaluation";

// Re-export: boardEvaluation
export { evaluateBoard, evaluateBoardWithBreakdown } from "./boardEvaluation";
