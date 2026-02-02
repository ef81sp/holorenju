/**
 * CPU共通定数
 *
 * SSoT (Single Source of Truth) として、4方向の探索に使用する定数を定義
 */

/**
 * 4方向のベクトル（探索・評価に使用）
 * - [0, 1]: 横（右）
 * - [1, 0]: 縦（下）
 * - [1, 1]: 右下斜め
 * - [1, -1]: 右上斜め
 */
export const DIRECTIONS: readonly [number, number][] = [
  [0, 1], // 横（右）
  [1, 0], // 縦（下）
  [1, 1], // 右下斜め
  [1, -1], // 右上斜め
] as const;

/**
 * renjuRules.ts の DIRECTIONS（8方向）に対応するインデックス
 *
 * renjuRules.ts の DIRECTIONS:
 * 0: 上, 1: 右上, 2: 右, 3: 右下, 4: 下, 5: 左下, 6: 左, 7: 左上
 *
 * このマッピング:
 * - DIRECTION_INDICES[0] = 2 → 横（右）は renjuRules の index 2
 * - DIRECTION_INDICES[1] = 0 → 縦（下）は renjuRules の index 0（上下ペアなので上を指定）
 * - DIRECTION_INDICES[2] = 3 → 右下斜めは renjuRules の index 3
 * - DIRECTION_INDICES[3] = 1 → 右上斜めは renjuRules の index 1
 */
export const DIRECTION_INDICES = [2, 0, 3, 1] as const;

/**
 * 無限大の代わりに使用する大きな値
 */
export const INFINITY = 1000000;
