/**
 * Minimax + Alpha-Beta剪定
 *
 * 「相手は最善手を打つ」と仮定し、数手先を読んで最良の手を選ぶ
 *
 * バレルファイル: 3つのサブモジュールから再エクスポート
 * - minimaxSimple: 基本的なMinimax探索（TT非使用）
 * - minimaxCore: TT/Move Ordering統合版のMinimax探索
 * - iterativeDeepening: 反復深化探索（TT統合版）
 */

// Simple minimax (TT非使用版)
export { findBestMove, findBestMoveIterative, minimax } from "./minimaxSimple";

// TT統合版コア
export { findBestMoveWithTT, minimaxWithTT } from "./minimaxCore";

// 反復深化（TT統合版）
export { findBestMoveIterativeWithTT } from "./iterativeDeepening";

// Re-export types and functions for backward compatibility
export {
  createSearchContext,
  type SearchContext,
  type SearchStats,
} from "./context";
export {
  extractPV,
  type DepthHistoryEntry,
  type IterativeDeepingResult,
  type MinimaxResult,
  type MoveScoreEntry,
  type PVExtractionResult,
  type RandomSelectionResult,
} from "./results";
