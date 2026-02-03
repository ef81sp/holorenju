/**
 * 盤面評価関数
 *
 * このファイルは後方互換性のためのリダイレクトです。
 * 実装は evaluation/ ディレクトリに分割されています。
 */

export {
  type BoardEvaluationBreakdown,
  DEFAULT_EVAL_OPTIONS,
  detectOpponentThreats,
  evaluateBoard,
  evaluateBoardWithBreakdown,
  evaluatePosition,
  evaluatePositionWithBreakdown,
  evaluateStonePatterns,
  evaluateStonePatternsWithBreakdown,
  type EvaluationOptions,
  FULL_EVAL_OPTIONS,
  type LeafEvaluationOptions,
  type LeafPatternScores,
  type PatternBreakdown,
  PATTERN_SCORES,
  type PatternScoreDetail,
  type ScoreBreakdown,
  type ThreatInfo,
} from "./evaluation/index";
