/**
 * CPU探索モジュール
 *
 * - VCF (Victory by Continuous Fours)
 * - VCT (Victory by Continuous Threats)
 * - Minimax + Alpha-Beta
 */

// 共通コンテキスト
export { type TimeLimiter, isTimeExceeded } from "./context";

// ライン解析（SSoT: core/lineAnalysis）
export { checkEnds, countLine } from "../core/lineAnalysis";

// 盤面ユーティリティ（SSoT: core/boardUtils）
export { countStones } from "../core/boardUtils";

// 脅威パターン（SSoT: threatPatterns）
export {
  findDefenseForConsecutiveFour,
  findDefenseForJumpFour,
  findFourMoves,
  findWinningMove,
  getFourDefensePosition,
  checkDefenseCounterThreat,
} from "./threatPatterns";

// VCF
export {
  hasVCF,
  findVCFMove,
  findVCFSequence,
  vcfAttackMoveCount,
  type VCFSearchOptions,
  type VCFSequenceResult,
} from "./vcf";

// VCT
export {
  hasVCT,
  findVCTMove,
  findVCTSequence,
  isVCTFirstMove,
  VCT_STONE_THRESHOLD,
  type VCTSearchOptions,
  type VCTSequenceResult,
} from "./vct";

// Minimax
export {
  findBestMove,
  findBestMoveIterative,
  findBestMoveWithTT,
  findBestMoveIterativeWithTT,
  minimax,
  minimaxWithTT,
  createSearchContext,
  type MinimaxResult,
  type IterativeDeepingResult,
  type SearchContext,
  type SearchStats,
} from "./minimax";
