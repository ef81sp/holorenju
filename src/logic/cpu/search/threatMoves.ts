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

/**
 * 四と活三を1パスの方向走査で同時に判定
 *
 * createsFour と createsOpenThree の両方が必要な呼び出し元で使用し、
 * 2回の方向走査を1回に削減する。
 *
 * @param board 盤面（石を置いた後の状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 四と活三の判定結果
 */
export interface ThreatClassification {
  createsFour: boolean;
  createsOpenThree: boolean;
}

export function classifyThreat(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): ThreatClassification {
  let hasFour = false;
  let hasOpenThree = false;

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

    const count = countLine(board, row, col, dr, dc, color);

    // 連続四をチェック
    if (count === 4) {
      const { end1Open, end2Open } = checkEnds(board, row, col, dr, dc, color);
      if (end1Open || end2Open) {
        hasFour = true;
      }
    }

    // 跳び四をチェック
    if (!hasFour && count !== 4) {
      if (checkJumpFour(board, row, col, dirIndex, color)) {
        hasFour = true;
      }
    }

    // 連続三をチェック
    if (count === 3) {
      const { end1Open, end2Open } = checkEnds(board, row, col, dr, dc, color);
      if (end1Open && end2Open) {
        hasOpenThree = true;
      }
    }

    // 跳び三をチェック
    if (!hasOpenThree && count !== 3) {
      if (checkJumpThree(board, row, col, dirIndex, color)) {
        hasOpenThree = true;
      }
    }

    // 両方見つかったら早期終了
    if (hasFour && hasOpenThree) {
      break;
    }
  }

  return { createsFour: hasFour, createsOpenThree: hasOpenThree };
}
