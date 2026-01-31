/**
 * 方向に関する定数
 *
 * 盤面上の8方向を表す。連珠のパターン評価やルール判定で使用。
 */

import type { Position } from "@/types/game";

/**
 * 8方向の差分ベクトル
 *
 * 4つのペア（対向する2方向）に分類:
 * - 横方向: 左右
 * - 縦方向: 上下
 * - 斜め（\方向）: 左上・右下
 * - 斜め（/方向）: 右上・左下
 */
export const DIRECTIONS: readonly Position[] = [
  { row: 0, col: 1 }, // 右
  { row: 1, col: 0 }, // 下
  { row: 1, col: 1 }, // 右下
  { row: 1, col: -1 }, // 左下
] as const;

/**
 * 全8方向（4方向 + 逆方向）
 */
export const ALL_DIRECTIONS: readonly Position[] = [
  { row: 0, col: 1 }, // 右
  { row: 0, col: -1 }, // 左
  { row: 1, col: 0 }, // 下
  { row: -1, col: 0 }, // 上
  { row: 1, col: 1 }, // 右下
  { row: -1, col: -1 }, // 左上
  { row: 1, col: -1 }, // 左下
  { row: -1, col: 1 }, // 右上
] as const;
