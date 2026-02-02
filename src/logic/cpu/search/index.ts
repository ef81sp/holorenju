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
  findFourMoves,
  findDefenseForConsecutiveFour,
  findDefenseForJumpFour,
  // 後方互換性のため
  checkEnds,
  countLine,
} from "./vcf";

// VCT
export {
  hasVCT,
  VCT_STONE_THRESHOLD,
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
