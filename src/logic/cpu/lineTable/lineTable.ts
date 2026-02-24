/**
 * LineTable — ビットマスクによるライン管理
 *
 * 72本のライン（横15+縦15+斜め↘21+斜め↗21）を Uint16Array のビットマスクで管理。
 * 石の配置/除去時に O(1)×4 で差分更新する。
 *
 * SoA (Structure of Arrays) レイアウト:
 * - blacks: Uint16Array(72) = 144 bytes（2キャッシュラインに収まる）
 * - whites: Uint16Array(72) = 144 bytes
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import type { BoardState } from "@/types/game";

import { BOARD_SIZE } from "@/constants";

import { CELL_LINES_FLAT, getCellLines } from "./lineMapping";

export interface LineTable {
  blacks: Uint16Array; // 各ラインの黒石ビットマスク
  whites: Uint16Array; // 各ラインの白石ビットマスク
}

/** 空のLineTableを生成。全72ラインのビットマスクが0。 */
export function createEmptyLineTable(): LineTable {
  return {
    blacks: new Uint16Array(72),
    whites: new Uint16Array(72),
  };
}

/** BoardState から全ラインを一括構築。 */
export function buildLineTable(board: BoardState): LineTable {
  const lt = createEmptyLineTable();

  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = board[r] ?? [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = row[c];
      if (cell === null) {
        continue;
      }

      const entries = getCellLines(r, c);
      if (cell === "black") {
        for (const entry of entries) {
          lt.blacks[entry.lineId] =
            (lt.blacks[entry.lineId] ?? 0) | (1 << entry.bitPos);
        }
      } else {
        for (const entry of entries) {
          lt.whites[entry.lineId] =
            (lt.whites[entry.lineId] ?? 0) | (1 << entry.bitPos);
        }
      }
    }
  }

  return lt;
}

/** 石を配置: 4ラインの該当ビットをOR。CELL_LINES_FLAT で高速ルックアップ。 */
export function placeStone(
  lt: LineTable,
  row: number,
  col: number,
  color: "black" | "white",
): void {
  const arr = color === "black" ? lt.blacks : lt.whites;
  const base = (row * 15 + col) * 4;
  for (let d = 0; d < 4; d++) {
    const packed = CELL_LINES_FLAT[base + d] ?? 0xffff;
    if (packed === 0xffff) {
      continue;
    }
    const idx = packed >> 8;
    arr[idx] = (arr[idx] ?? 0) | (1 << (packed & 0xff));
  }
}

/** 石を除去: 4ラインの該当ビットをAND NOT。CELL_LINES_FLAT で高速ルックアップ。 */
export function removeStone(
  lt: LineTable,
  row: number,
  col: number,
  color: "black" | "white",
): void {
  const arr = color === "black" ? lt.blacks : lt.whites;
  const base = (row * 15 + col) * 4;
  for (let d = 0; d < 4; d++) {
    const packed = CELL_LINES_FLAT[base + d] ?? 0xffff;
    if (packed === 0xffff) {
      continue;
    }
    const idx = packed >> 8;
    arr[idx] = (arr[idx] ?? 0) & ~(1 << (packed & 0xff));
  }
}
