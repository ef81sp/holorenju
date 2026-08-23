/**
 * 勝利パターン検出
 *
 * 白の三三・四四パターン検出と四三判定
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import type { BoardState } from "@/types/game";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
// #43 PR-3: 跳び四/三の図形判定を Zig アダプタへ委譲（patterns.ts 依存を断つ）。
// detectWhiteWinningPattern は forcedLossCheck から live なため本ファイルは存続。
import { checkJumpFour, checkJumpThree } from "../wasm/patternsAdapter";
import { analyzeDirection } from "./directionAnalysis";
import {
  analyzeJumpPatterns,
  isValidConsecutiveThree,
  isValidJumpThree,
} from "./jumpPatterns";

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

    // 活三カウント（制約ライン検証付き）
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty" &&
      isValidConsecutiveThree(board, row, col, dirIndex, "white")
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

    // 跳び三をチェック（連続三がない場合のみ、制約ライン検証付き）
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, "white") &&
      isValidJumpThree(board, row, col, dirIndex, "white")
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
 * 白の三三・四四パターンを1パスで検出・分類する
 *
 * checkWhiteWinningPattern + classifyWhiteWinningPattern を統合し、
 * 同じ8方向を2回走査する冗長性を解消。
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @returns "double-four"（四四）、"double-three"（三三）、該当なしなら null
 */
export function detectWhiteWinningPattern(
  board: BoardState,
  row: number,
  col: number,
): "double-three" | "double-four" | null {
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

    // 活三カウント（制約ライン検証付き）
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty" &&
      isValidConsecutiveThree(board, row, col, dirIndex, "white")
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

    // 跳び三をチェック（連続三がない場合のみ、制約ライン検証付き）
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, "white") &&
      isValidJumpThree(board, row, col, dirIndex, "white")
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

  if (fourCount >= 2) {
    return "double-four";
  }
  if (openThreeCount >= 2) {
    return "double-three";
  }
  return null;
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

    // 活三カウント（制約ライン検証付き）
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty" &&
      isValidConsecutiveThree(board, row, col, dirIndex, color)
    ) {
      openThreeCount++;
    } else if (
      // 跳び三をチェック（連続三がない場合のみ、制約ライン検証付き）
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, color) &&
      isValidJumpThree(board, row, col, dirIndex, color)
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

// issue #134 / #43: `createsFourThreeBit`（createsFourThree の LineTable ハイブリッド版）は
// 削除した。参照ゼロ（本番経路は Zig `evaluate.createsFourThree`）で、`analyzeJumpPatterns` の
// `precomputed` 経路を使う唯一の呼び出し元だったため、四判定を五点列挙へ統一した #134 の
// 新旧等価性が検証されないまま残るのは害のほうが大きい。
// 必要になったら `analyzeJumpPatterns(board, row, col, color, precomputed)` から作り直すこと。
