/**
 * LineTable アダプタ
 *
 * LineTable があればビットマスク版、なければ従来版を使用。
 * フォールバック分岐を消費者に散在させず、この1箇所に集約する。
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import type { BoardState } from "@/types/game";

import { checkFive, checkOverline } from "@/logic/renjuRules";

import type { DirectionPattern } from "../evaluation/patternScores";
import type { LineTable } from "./lineTable";

import { DIRECTIONS } from "../core/constants";
import { analyzeDirection } from "../evaluation/directionAnalysis";
import { checkFiveBit, checkOverlineBit } from "./lineChecks";
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

/**
 * 五連判定アダプタ
 *
 * LineTable があればビットマスク版、なければ renjuRules 版を使用。
 * 配置済み・未配置どちらの石にも対応（countLineBit が起点を常に+1するため）。
 */
export function isFive(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
  lineTable?: LineTable,
): boolean {
  if (lineTable) {
    return checkFiveBit(lineTable.blacks, lineTable.whites, row, col, color);
  }
  return checkFive(board, row, col, color);
}

/**
 * 長連判定アダプタ
 */
export function isOverline(
  board: BoardState,
  row: number,
  col: number,
  lineTable?: LineTable,
): boolean {
  if (lineTable) {
    return checkOverlineBit(lineTable.blacks, lineTable.whites, row, col);
  }
  return checkOverline(board, row, col);
}
