/**
 * テスト用のボード操作ユーティリティ
 * strictNullChecksでの配列アクセスを安全に行うためのヘルパー関数
 */

import type { BoardState, StoneColor } from "@/types/game";

/**
 * ボードのセルに石を配置（テスト用）
 * @throws 無効なインデックスの場合はエラー
 */
export function setCell(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
): void {
  const boardRow = board[row];
  if (!boardRow) {
    throw new Error(`Invalid row index: ${row}`);
  }
  boardRow[col] = color;
}

/**
 * ボードのセルの値を取得（テスト用）
 */
export function getCell(
  board: BoardState,
  row: number,
  col: number,
): StoneColor | undefined {
  return board[row]?.[col];
}
