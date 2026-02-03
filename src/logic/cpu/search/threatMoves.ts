/**
 * 脅威手の判定（共通ロジック）
 *
 * VCF/VCT探索で使用する四・活三の判定関数を共通化（DRY）
 */

import type { BoardState } from "@/types/game";

import { checkJumpFour, checkJumpThree } from "@/logic/renjuRules";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { checkEnds, countLine } from "../core/lineAnalysis";

/**
 * 指定位置に石を置くと四ができるかチェック
 *
 * @param board 盤面（石を置いた後の状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 四ができる場合true
 */
export function createsFour(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
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

    // 連続四をチェック
    const count = countLine(board, row, col, dr, dc, color);
    if (count === 4) {
      // 片方でも開いていれば四
      const { end1Open, end2Open } = checkEnds(board, row, col, dr, dc, color);
      if (end1Open || end2Open) {
        return true;
      }
    }

    // 跳び四をチェック
    if (count !== 4 && checkJumpFour(board, row, col, dirIndex, color)) {
      return true;
    }
  }

  return false;
}

/**
 * 指定位置に石を置くと活三ができるかチェック
 *
 * @param board 盤面（石を置いた後の状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 活三ができる場合true
 */
export function createsOpenThree(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
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

    // 連続三をチェック
    const count = countLine(board, row, col, dr, dc, color);
    if (count === 3) {
      const { end1Open, end2Open } = checkEnds(board, row, col, dr, dc, color);
      if (end1Open && end2Open) {
        return true;
      }
    }

    // 跳び三をチェック
    if (count !== 3 && checkJumpThree(board, row, col, dirIndex, color)) {
      return true;
    }
  }

  return false;
}
