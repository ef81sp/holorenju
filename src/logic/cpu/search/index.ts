/**
 * CPU探索モジュール
 *
 * - VCF (Victory by Continuous Fours)
 * - VCT (Victory by Continuous Threats)
 * - Minimax + Alpha-Beta
 */

// VCF
export {
  hasVCF,
  findVCFMove,
  findVCFSequence,
  vcfAttackMoveCount,
  findFourMoves,
  findDefenseForConsecutiveFour,
  findDefenseForJumpFour,
  type VCFSearchOptions,
  type VCFSequenceResult,
  // 後方互換性のため
  checkEnds,
  countLine,
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
  // 後方互換性のため
  countStones,
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
