/**
 * CPU AI ライン解析ユーティリティ
 *
 * SSoT (Single Source of Truth) として連の解析に関する関数を提供
 */

import type { BoardState, Position } from "@/types/game";

import { isValidPosition } from "@/logic/renjuRules";

/**
 * 指定方向に連続する石の数をカウント
 *
 * @param board 盤面
 * @param row 起点の行
 * @param col 起点の列
 * @param dr 行方向のベクトル
 * @param dc 列方向のベクトル
 * @param color 石の色
 * @returns 連続する石の数（起点自身を含む）
 */
export function countLine(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): number {
  let count = 1; // 起点自身

  // 正方向
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    count++;
    r += dr;
    c += dc;
  }

  // 負方向
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    count++;
    r -= dr;
    c -= dc;
  }

  return count;
}

/**
 * 連の両端の状態をチェック
 *
 * @param board 盤面
 * @param row 起点の行
 * @param col 起点の列
 * @param dr 行方向のベクトル
 * @param dc 列方向のベクトル
 * @param color 石の色
 * @returns 両端の開閉状態（end1Open: 正方向端が空き, end2Open: 負方向端が空き）
 */
export function checkEnds(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { end1Open: boolean; end2Open: boolean } {
  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r += dr;
    c += dc;
  }
  const end1Open = isValidPosition(r, c) && board[r]?.[c] === null;

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r -= dr;
    c -= dc;
  }
  const end2Open = isValidPosition(r, c) && board[r]?.[c] === null;

  return { end1Open, end2Open };
}

/**
 * 連の両端の位置を取得
 *
 * @param board 盤面
 * @param row 起点の行
 * @param col 起点の列
 * @param dr 行方向のベクトル
 * @param dc 列方向のベクトル
 * @param color 石の色
 * @returns 両端の空き位置（空いている端のみ含む）
 */
export function getLineEnds(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): Position[] {
  const positions: Position[] = [];

  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r -= dr;
    c -= dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  return positions;
}
