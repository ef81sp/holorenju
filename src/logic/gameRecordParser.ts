/**
 * 連珠棋譜パーサー
 *
 * 棋譜形式: "H8 G7 I7 H6 ..."
 * - 列: A-O（左から右、A=0, O=14）
 * - 行: 1-15（下から上、1=row14, 15=row0）
 */

import type { BoardState, Position, StoneColor } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

/**
 * 単一の手を座標に変換
 *
 * @param move 手の文字列（例: "H8"）
 * @returns 座標
 */
export function parseMove(move: string): Position {
  const col = move.charCodeAt(0) - "A".charCodeAt(0);
  const rowNum = parseInt(move.slice(1), 10);
  const row = 15 - rowNum;
  return { row, col };
}

/**
 * 座標を棋譜表記に変換
 *
 * @param pos 座標
 * @returns 棋譜表記（例: "H8"）
 */
export function formatMove(pos: Position): string {
  const col = String.fromCharCode("A".charCodeAt(0) + pos.col);
  const row = 15 - pos.row;
  return `${col}${row}`;
}

/**
 * 棋譜文字列を手の配列に変換
 *
 * @param record 棋譜文字列（スペース区切り）
 * @returns 手の配列
 */
export function parseGameRecord(
  record: string,
): { position: Position; color: StoneColor }[] {
  const moves = record.trim().split(/\s+/);
  return moves.map((move, i) => ({
    position: parseMove(move),
    color: i % 2 === 0 ? "black" : "white",
  }));
}

/**
 * 棋譜文字列から盤面を作成
 *
 * @param record 棋譜文字列（スペース区切り）
 * @param moveCount 再現する手数（省略時は全て）
 * @returns 盤面と次の手番
 */
export function createBoardFromRecord(
  record: string,
  moveCount?: number,
): { board: BoardState; nextColor: StoneColor } {
  const board = createEmptyBoard();
  const moves = parseGameRecord(record);
  const count = moveCount ?? moves.length;

  for (let i = 0; i < count && i < moves.length; i++) {
    const move = moves[i];
    if (!move) {
      continue;
    }
    const { position, color } = move;
    const boardRow = board[position.row];
    if (boardRow) {
      boardRow[position.col] = color;
    }
  }

  const nextColor: StoneColor = count % 2 === 0 ? "black" : "white";
  return { board, nextColor };
}
