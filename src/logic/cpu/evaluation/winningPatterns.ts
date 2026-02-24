/**
 * 勝利パターン検出
 *
 * 白の三三・四四パターン検出と四三判定
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import type { BoardState } from "@/types/game";

import { checkJumpFour, checkJumpThree } from "@/logic/renjuRules";

import type { LineTable } from "../lineTable/lineTable";
import type { DirectionPattern } from "./patternScores";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { CELL_LINES_FLAT } from "../lineTable/lineMapping";
import { analyzeLinePattern } from "../lineTable/linePatterns";
import { placeStone, removeStone } from "../lineTable/lineTable";
import { analyzeDirection } from "./directionAnalysis";
import { analyzeJumpPatterns } from "./jumpPatterns";

/**
 * 白の三三・四四パターンをチェック
 * 白には禁手がないため、三三・四四は即勝利となる
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @returns 三三または四四なら true
 */
export function checkWhiteWinningPattern(
  board: BoardState,
  row: number,
  col: number,
): boolean {
  let openThreeCount = 0;
  let fourCount = 0;

  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) {
      continue;
    }

    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, "white");

    // 活三カウント
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty"
    ) {
      openThreeCount++;
    }

    // 四カウント（活四・止め四両方）
    if (
      pattern.count === 4 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      fourCount++;
    }

    // 跳び三をチェック（連続三がない場合のみ）
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, "white")
    ) {
      openThreeCount++;
    }

    // 跳び四をチェック（連続四がない場合のみ）
    if (
      pattern.count !== 4 &&
      checkJumpFour(board, row, col, dirIndex, "white")
    ) {
      fourCount++;
    }
  }

  // 三三（活三2つ以上）または四四（四2つ以上）なら即勝利
  return openThreeCount >= 2 || fourCount >= 2;
}

/**
 * 指定位置に石を置くと三三ができるかチェック
 * checkWhiteWinningPattern の三三判定ロジックを抽出した軽量版（四四チェック省略）
 *
 * @param board 盤面
 * @param row 行
 * @param col 列
 * @param color 石の色
 * @returns 三三（活三2つ以上）なら true
 */
export function createsDoubleThree(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  // 盤面を直接変更
  const targetRow = board[row];
  if (targetRow) {
    targetRow[col] = color;
  }

  let openThreeCount = 0;

  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) {
      continue;
    }

    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);

    // 活三カウント
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty"
    ) {
      openThreeCount++;
    } else if (
      // 跳び三をチェック（連続三がない場合のみ）
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, color)
    ) {
      openThreeCount++;
    }

    // 2つ見つかった時点で早期リターン
    if (openThreeCount >= 2) {
      if (targetRow) {
        targetRow[col] = null;
      }
      return true;
    }
  }

  // 盤面を元に戻す
  if (targetRow) {
    targetRow[col] = null;
  }
  return false;
}

/**
 * 指定位置に石を置くと四三ができるかチェック
 * 最適化: 盤面を直接変更して元に戻す方式（copyBoard不要）
 */
export function createsFourThree(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  // 盤面を直接変更
  const targetRow = board[row];
  if (targetRow) {
    targetRow[col] = color;
  }

  // 四と有効な活三を同時に作るかチェック
  const jumpResult = analyzeJumpPatterns(board, row, col, color);
  const result = jumpResult.hasFour && jumpResult.hasValidOpenThree;

  // 盤面を元に戻す
  if (targetRow) {
    targetRow[col] = null;
  }

  return result;
}

/**
 * createsFourThree のハイブリッド版
 *
 * 連続パターン検出を LineTable 版 (analyzeLinePattern) に置換し、
 * board 走査の ~80 reads を 4× ビットマスク演算に削減。
 *
 * 跳びパターン検出 (checkJumpFour/checkJumpThree) は
 * renjuRules.ts の board ベース実装をそのまま使用（board place/remove が必要）。
 *
 * analyzeJumpPatterns の precomputed パラメータ経由で
 * LineTable から得た DirectionPattern[] を渡す。
 */
export function createsFourThreeBit(
  board: BoardState,
  lineTable: LineTable,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  // 盤面 + LineTable 両方に仮置き
  const targetRow = board[row];
  if (targetRow) {
    targetRow[col] = color;
  }
  placeStone(lineTable, row, col, color);

  // LineTable から4方向の DirectionPattern を取得（board 走査を回避）
  const patterns: DirectionPattern[] = [];
  const base = (row * 15 + col) * 4;
  for (let d = 0; d < 4; d++) {
    const packed = CELL_LINES_FLAT[base + d]!;
    if (packed === 0xffff) {
      patterns.push({ count: 1, end1: "edge", end2: "edge" });
      continue;
    }
    const lineId = packed >> 8;
    const bitPos = packed & 0xff;
    patterns.push(
      analyzeLinePattern(
        lineTable.blacks,
        lineTable.whites,
        lineId,
        bitPos,
        color,
        d === 3,
      ),
    );
  }

  // analyzeJumpPatterns に precomputed patterns を渡す
  // → 内部の computePatterns (= 4× analyzeDirection board走査) をスキップ
  // → checkJumpFour/checkJumpThree は board を使用（仮置き済み）
  const jumpResult = analyzeJumpPatterns(board, row, col, color, patterns);
  const result = jumpResult.hasFour && jumpResult.hasValidOpenThree;

  // 復元
  if (targetRow) {
    targetRow[col] = null;
  }
  removeStone(lineTable, row, col, color);

  return result;
}
