/**
 * ゲーム分析データのフィルタロジック
 * CLI (browse-games) とブラウザ (GameBrowser) の両方から利用
 */

import type { BrowseFilter, GameAnalysis } from "../types/analysis.ts";

/**
 * フィルタ条件に一致するか判定
 */
export function matchesFilter(
  game: GameAnalysis,
  filter: BrowseFilter,
): boolean {
  // タグフィルタ
  if (filter.tags && filter.tags.length > 0) {
    const hasAllTags = filter.tags.every((tag) => game.gameTags.includes(tag));
    if (!hasAllTags) {
      return false;
    }
  }

  // マッチアップフィルタ
  if (filter.matchup) {
    if (!game.matchup.toLowerCase().includes(filter.matchup.toLowerCase())) {
      return false;
    }
  }

  // 手数フィルタ
  if (filter.movesMin !== undefined && game.totalMoves < filter.movesMin) {
    return false;
  }
  if (filter.movesMax !== undefined && game.totalMoves > filter.movesMax) {
    return false;
  }

  // 勝者フィルタ
  if (filter.winner) {
    if (filter.winner === "draw" && game.winner !== "draw") {
      return false;
    }
    if (filter.winner === "black" && game.winner !== "A") {
      return false;
    }
    if (filter.winner === "white" && game.winner !== "B") {
      return false;
    }
  }

  // 珠型フィルタ
  if (filter.jushu) {
    if (!game.opening || game.opening.jushu !== filter.jushu) {
      return false;
    }
  }

  return true;
}
