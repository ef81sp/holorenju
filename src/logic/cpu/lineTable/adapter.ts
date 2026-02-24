/**
 * 方向パターン取得アダプタ
 *
 * LineTable があればビットマスク版、なければ従来版を使用。
 * フォールバック分岐を消費者に散在させず、この1箇所に集約する。
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import type { BoardState } from "@/types/game";

import type { DirectionPattern } from "../evaluation/patternScores";
import type { LineTable } from "./lineTable";

import { DIRECTIONS } from "../core/constants";
import { analyzeDirection } from "../evaluation/directionAnalysis";
import { CELL_LINES_FLAT } from "./lineMapping";
import { analyzeLinePattern } from "./linePatterns";

/**
 * 方向パターンを取得する
 *
 * @param lineTable 指定時はビットマスク版を使用。未指定なら従来の board 走査版
 */
export function getDirectionPattern(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: "black" | "white",
  lineTable?: LineTable,
): DirectionPattern {
  if (lineTable) {
    const packed = CELL_LINES_FLAT[(row * 15 + col) * 4 + dirIndex]!;
    if (packed === 0xffff) {
      // ラインが5未満（短い斜め）: 盤外と同等
      return { count: 1, end1: "edge", end2: "edge" };
    }
    const lineId = packed >> 8;
    const bitPos = packed & 0xff;
    return analyzeLinePattern(
      lineTable.blacks,
      lineTable.whites,
      lineId,
      bitPos,
      color,
      dirIndex === 3, // ↗方向はビット方向が物理方向と逆転
    );
  }
  const dir = DIRECTIONS[dirIndex]!;
  return analyzeDirection(board, row, col, dir[0], dir[1], color);
}
