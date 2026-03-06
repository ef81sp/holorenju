/**
 * CPUライン解析ユーティリティ
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
 * 4連専用の端チェック（黒の長連判定付き）
 *
 * checkEnds と同じだが、黒番のとき開き端の1マス先に黒石があれば
 * その端を閉じと判定する（打つと6連=長連になるため）。
 * 白番では checkEnds と同一動作。
 */
export function checkEndsForFour(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { end1Open: boolean; end2Open: boolean } {
  // 正方向の端（端位置を保持して再走査を回避）
  let end1R = row + dr;
  let end1C = col + dc;
  while (isValidPosition(end1R, end1C) && board[end1R]?.[end1C] === color) {
    end1R += dr;
    end1C += dc;
  }
  let end1Open =
    isValidPosition(end1R, end1C) && board[end1R]?.[end1C] === null;

  // 負方向の端
  let end2R = row - dr;
  let end2C = col - dc;
  while (isValidPosition(end2R, end2C) && board[end2R]?.[end2C] === color) {
    end2R -= dr;
    end2C -= dc;
  }
  let end2Open =
    isValidPosition(end2R, end2C) && board[end2R]?.[end2C] === null;

  // 黒番: 開き端の1マス先に黒石があれば長連 → その端は無効
  if (color === "black") {
    if (end1Open) {
      const beyondR = end1R + dr;
      const beyondC = end1C + dc;
      if (
        isValidPosition(beyondR, beyondC) &&
        board[beyondR]?.[beyondC] === "black"
      ) {
        end1Open = false;
      }
    }
    if (end2Open) {
      const beyondR = end2R - dr;
      const beyondC = end2C - dc;
      if (
        isValidPosition(beyondR, beyondC) &&
        board[beyondR]?.[beyondC] === "black"
      ) {
        end2Open = false;
      }
    }
  }

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
