/**
 * 棋譜文字列から局面データを構造化するローダー
 *
 * 棋譜パーサー（gameRecordParser）の薄いラッパー。
 * スクリプトやデバッグで局面を扱いやすい形に変換する。
 */

import type { BoardState, Position, StoneColor } from "../../src/types/game.ts";

import {
  createBoardFromRecord,
  formatMove,
  parseGameRecord,
  parseMove,
} from "../../src/logic/gameRecordParser.ts";
import { boardToAscii } from "./boardDisplay.ts";

/** 1手の情報 */
export interface MoveEntry {
  /** 手数（1始まり） */
  moveNumber: number;
  /** 棋譜表記（例: "H8"） */
  notation: string;
  /** 座標 */
  position: Position;
  /** 石の色 */
  color: StoneColor;
}

/** 構造化された局面データ */
export interface LoadedPosition {
  /** 盤面 */
  board: BoardState;
  /** 次の手番 */
  nextColor: StoneColor;
  /** 手の一覧 */
  moves: MoveEntry[];
  /** 総手数 */
  moveCount: number;
  /** 盤上の石数（黒+白） */
  stoneCount: number;
  /** 元の棋譜文字列 */
  record: string;
}

/**
 * 棋譜文字列から局面データをロード
 *
 * @param record 棋譜文字列（例: "H8 G7 I9 I7 ..."）
 * @param upToMove 何手目まで再現するか（省略時は全て）
 * @returns 構造化された局面データ
 */
export function loadPosition(
  record: string,
  upToMove?: number,
): LoadedPosition {
  const parsed = parseGameRecord(record);
  const count = upToMove ?? parsed.length;
  const { board, nextColor } = createBoardFromRecord(record, count);

  const moves: MoveEntry[] = parsed.slice(0, count).map((m, i) => ({
    moveNumber: i + 1,
    notation: formatMove(m.position),
    position: m.position,
    color: m.color,
  }));

  let stoneCount = 0;
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r]?.[c]) {
        stoneCount++;
      }
    }
  }

  return {
    board,
    nextColor,
    moves,
    moveCount: count,
    stoneCount,
    record: record.trim(),
  };
}

/**
 * 局面のサマリーを文字列で返す
 */
export function formatPositionSummary(pos: LoadedPosition): string {
  const lines: string[] = [];
  lines.push(
    `手数: ${pos.moveCount}  次の手番: ${pos.nextColor === "black" ? "黒" : "白"}  石数: ${pos.stoneCount}`,
  );
  lines.push("");
  lines.push(boardToAscii(pos.board, { showCoordinates: true }));
  return lines.join("\n");
}

// Re-export for convenience
export { parseMove, formatMove };
