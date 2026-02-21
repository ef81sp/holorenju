/**
 * SGF棋譜の手抽出
 *
 * 五目クエスト等のSGF文字列から手の座標を抽出し、
 * ネイティブ棋譜文字列（"H8 I7 I9 ..."）に変換する。
 *
 * SGF座標: [col_letter][row_letter] (小文字2文字, a=0, origin=top-left)
 * 内部座標: Position { row: 0-14, col: 0-14 } (row 0=top, col 0=left)
 */

import type { Position } from "@/types/game";

import { formatMove } from "@/logic/gameRecordParser";

const BOARD_SIZE = 15;
const CODE_A = "a".charCodeAt(0);

/** `;B[xx]` または `;W[xx]` にマッチ */
const SGF_MOVE_PATTERN = /;[BW]\[([a-o]{2})\]/g;

/**
 * 入力文字列がSGF形式かどうかを判定する
 */
export function isSgfFormat(input: string): boolean {
  return /^\s*\(;/.test(input);
}

/**
 * SGF座標（小文字2文字）を内部座標に変換する
 */
export function parseSgfCoord(coord: string): Position {
  const col = coord.charCodeAt(0) - CODE_A;
  const row = coord.charCodeAt(1) - CODE_A;
  return { row, col };
}

/**
 * SGF文字列から手を抽出してネイティブ棋譜文字列に変換する
 *
 * @returns 棋譜文字列（"H8 I7 I9 ..."）、手が見つからなければ null
 */
export function convertSgfToRecord(input: string): string | null {
  const moves: string[] = [];
  const seen = new Set<number>();

  for (const match of input.matchAll(SGF_MOVE_PATTERN)) {
    const pos = parseSgfCoord(match[1] ?? "");
    const key = pos.row * BOARD_SIZE + pos.col;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    moves.push(formatMove(pos));
  }

  return moves.length > 0 ? moves.join(" ") : null;
}
