/**
 * 勝利パターン検出
 *
 * 白の三三・四四パターン検出と四三判定
 */

import type { BoardState } from "@/types/game";

import { checkJumpFour, checkJumpThree } from "@/logic/renjuRules";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
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
