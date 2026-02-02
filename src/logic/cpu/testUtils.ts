/**
 * CPUテスト用ユーティリティ
 */

import type { BoardState, StoneColor } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

/**
 * テスト用の盤面にパターンを配置するヘルパー
 *
 * @param board 盤面（変更される）
 * @param stones 配置する石の配列
 */
export function placeStonesOnBoard(
  board: BoardState,
  stones: { row: number; col: number; color: StoneColor }[],
): void {
  for (const stone of stones) {
    const row = board[stone.row];
    if (row) {
      row[stone.col] = stone.color;
    }
  }
}

/**
 * 石を配置した盤面を作成するヘルパー
 *
 * @param stones 配置する石の配列
 * @returns 石が配置された盤面
 */
export function createBoardWithStones(
  stones: { row: number; col: number; color: StoneColor }[],
): BoardState {
  const board = createEmptyBoard();
  placeStonesOnBoard(board, stones);
  return board;
}
