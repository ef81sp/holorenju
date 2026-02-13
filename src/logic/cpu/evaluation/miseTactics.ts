/**
 * ミセ手戦術
 *
 * ミセ手（四三を狙う手）の検出と評価
 */

import type { BoardState, Position } from "@/types/game";

import { checkForbiddenMove, isValidPosition } from "@/logic/renjuRules";

import { DIRECTIONS } from "../core/constants";
import { analyzeDirection } from "./directionAnalysis";
import { createsFourThree } from "./winningPatterns";

/**
 * ミセターゲット（四三点）を軽量検出
 *
 * ライン延長点のみをスキャンする高速版。±2近傍の全探索を省略し、
 * 各方向で2石以上の連続がある場合のみ端点を createsFourThree で検証する。
 * Mise-VCF探索で重要なのはライン上の四三点であり、ライン外の四三点は不要。
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 四三点の配列
 */
export function findMiseTargetsLite(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  const targets: Position[] = [];
  const seen = new Set<string>();

  for (const direction of DIRECTIONS) {
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);
    if (pattern.count < 2) {
      continue;
    } // 2石未満→四三不可能

    // 正方向端・負方向端をwalk
    for (const sign of [1, -1]) {
      let r = row + sign * dr;
      let c = col + sign * dc;
      while (isValidPosition(r, c) && board[r]?.[c] === color) {
        r += sign * dr;
        c += sign * dc;
      }
      if (!isValidPosition(r, c) || board[r]?.[c] !== null) {
        continue;
      }

      const key = `${r},${c}`;
      if (seen.has(key)) {
        continue;
      }

      // 黒の禁手チェック
      if (color === "black") {
        const forbidden = checkForbiddenMove(board, r, c);
        if (forbidden.isForbidden) {
          continue;
        }
      }

      if (createsFourThree(board, r, c, color)) {
        targets.push({ row: r, col: c });
        seen.add(key);
      }
    }
  }
  return targets;
}

/**
 * ミセターゲットが存在しうるか安価にチェック（プリフィルタ）
 *
 * analyzeDirection のみ使用し、2石以上の連続かつ片端が空きなら true。
 * createsFourThree を呼ばないため非常に安価（~40 ops/候補手）。
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns ミセターゲットが存在しうるなら true
 */
export function hasPotentialMiseTarget(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  for (const direction of DIRECTIONS) {
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);
    // 2石以上の連続があり、少なくとも片端が空き
    if (
      pattern.count >= 2 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * ミセターゲット（四三点）を検出
 *
 * 置いた石から各方向のライン延長点と±2近傍をスキャンし、
 * 四三が作れる位置を列挙する。ライン延長点ベースにより、
 * ±2を超える距離の四三点も検出可能。
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 四三点の配列
 */
export function findMiseTargets(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  const targets: Position[] = [];
  const seen = new Set<string>();

  const tryAdd = (r: number, c: number): void => {
    const key = `${r},${c}`;
    if (seen.has(key)) {
      return;
    }
    if (!isValidPosition(r, c) || board[r]?.[c] !== null) {
      return;
    }

    // 黒の禁手チェック
    if (color === "black") {
      const forbidden = checkForbiddenMove(board, r, c);
      if (forbidden.isForbidden) {
        return;
      }
    }

    if (createsFourThree(board, r, c, color)) {
      targets.push({ row: r, col: c });
      seen.add(key);
    }
  };

  // 1. 各方向のライン延長点（距離制限なし）
  for (const direction of DIRECTIONS) {
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);

    // 2石以上の連続がなければスキップ
    if (pattern.count < 2) {
      continue;
    }

    // 正方向の端
    let r = row + dr;
    let c = col + dc;
    while (isValidPosition(r, c) && board[r]?.[c] === color) {
      r += dr;
      c += dc;
    }
    if (isValidPosition(r, c) && board[r]?.[c] === null) {
      tryAdd(r, c);
    }

    // 負方向の端
    r = row - dr;
    c = col - dc;
    while (isValidPosition(r, c) && board[r]?.[c] === color) {
      r -= dr;
      c -= dc;
    }
    if (isValidPosition(r, c) && board[r]?.[c] === null) {
      tryAdd(r, c);
    }
  }

  // 2. ±2近傍スキャン（ライン外の四三点も検出）
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) {
        continue;
      }
      tryAdd(row + dr, col + dc);
    }
  }

  return targets;
}

/**
 * ミセ手判定
 * 次の手で四三が作れる位置かどうかをチェック
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns ミセ手ならtrue
 */
export function isMiseMove(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  return findMiseTargets(board, row, col, color).length > 0;
}
