/**
 * 候補手の近傍判定
 *
 * 既存石の周囲2マス以内かを判定するヘルパー。
 * （旧: 候補手生成 generateMoves / generateSortedMoves・着手順序 sortMoves は
 *  対局CPUの Zig/WASM 化に伴い死蔵化したため削除済み。）
 */

import type { BoardState } from "@/types/game";

import { isValidPosition } from "@/logic/renjuRules";

/** 探索範囲（既存石からの距離） */
const SEARCH_RANGE = 2;

/**
 * 指定位置が既存の石の周囲にあるかチェック
 *
 * @param board 盤面
 * @param row 行
 * @param col 列
 * @param range 範囲（デフォルト: 2）
 * @returns 既存石の周囲にあればtrue
 */
export function isNearExistingStone(
  board: BoardState,
  row: number,
  col: number,
  range: number = SEARCH_RANGE,
): boolean {
  for (let dr = -range; dr <= range; dr++) {
    for (let dc = -range; dc <= range; dc++) {
      if (dr === 0 && dc === 0) {
        continue;
      }

      const nr = row + dr;
      const nc = col + dc;

      if (isValidPosition(nr, nc) && board[nr]?.[nc] !== null) {
        return true;
      }
    }
  }

  return false;
}
