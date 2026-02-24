/**
 * セル座標 → ライン情報のマッピング
 *
 * 15×15盤面の72本のラインに対し、各セルがどのラインの何ビット目に
 * 対応するかを静的テーブルとして保持する。モジュール初期化時に1度だけ生成。
 *
 * lineId 番号体系:
 *   0~14  : 横（row 0~14）
 *   15~29 : 縦（col 0~14）
 *   30~50 : 斜め↘（row-col = -10..+10 の21本、長さ5~15）
 *   51~71 : 斜め↗（row+col = 4..24 の21本、長さ5~15）
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import { BOARD_SIZE } from "@/constants";

export interface LineMappingEntry {
  lineId: number; // 0~71
  bitPos: number; // 0~14（ライン内でのビット位置）
  dirIndex: number; // 0~3 (横/縦/↘/↗)
}

/** 72本のライン長 (5~15)。盤面幾何から静的に決定。 */
export const LINE_LENGTHS: Uint8Array = buildLineLengths();

/** 225セル × 最大4方向のマッピング配列。 */
export const CELL_TO_LINES: readonly LineMappingEntry[][] = buildCellToLines();

/**
 * ホットパス向けフラット化テーブル。
 * packed = CELL_LINES_FLAT[(row * 15 + col) * 4 + dirIndex]
 * lineId = packed >> 8, bitPos = packed & 0xFF
 * エントリなし方向は 0xFFFF。
 */
export const CELL_LINES_FLAT: Uint16Array = buildCellLinesFlat();

/**
 * ライン逆引きテーブル
 * LINE_BIT_TO_CELL[lineId * 16 + bitPos] = row * 15 + col
 * 72 * 16 = 1152 entries (Uint16Array, 2304 bytes)
 * bitPos がライン長超過の場合は 0xFFFF (sentinel)
 */
export const LINE_BIT_TO_CELL: Uint16Array = buildLineBitToCell();

/** lineId から方向インデックス (0:横, 1:縦, 2:↘, 3:↗) を返す */
export function getDirIndexFromLineId(lineId: number): number {
  if (lineId < 15) {
    return 0;
  }
  if (lineId < 30) {
    return 1;
  }
  if (lineId < 51) {
    return 2;
  }
  return 3;
}

/** 指定セルが属するラインのエントリ配列を返す（事前計算済み配列への参照）。 */
export function getCellLines(row: number, col: number): LineMappingEntry[] {
  return CELL_TO_LINES[row * BOARD_SIZE + col] ?? [];
}

// === 内部ビルド関数 ===

function buildLineLengths(): Uint8Array {
  const lengths = new Uint8Array(72);

  // 横ライン (0~14): 常に15
  for (let i = 0; i < 15; i++) {
    lengths[i] = BOARD_SIZE;
  }

  // 縦ライン (15~29): 常に15
  for (let i = 0; i < 15; i++) {
    lengths[15 + i] = BOARD_SIZE;
  }

  // 斜め↘ (30~50): row-col = -10..+10
  // offset i=0 → row-col=-10 → 長さ5
  // offset i=10 → row-col=0 → 長さ15
  for (let i = 0; i < 21; i++) {
    lengths[30 + i] = BOARD_SIZE - Math.abs(i - 10);
  }

  // 斜め↗ (51~71): row+col = 4..24
  // sum=4 → 長さ5, sum=14 → 長さ15, sum=24 → 長さ5
  for (let i = 0; i < 21; i++) {
    const sum = i + 4;
    lengths[51 + i] = sum <= 14 ? sum + 1 : 29 - sum;
  }

  return lengths;
}

function buildCellToLines(): LineMappingEntry[][] {
  const table: LineMappingEntry[][] = new Array(225);

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const entries: LineMappingEntry[] = [];

      // 横: lineId = row, bitPos = col
      entries.push({ lineId: r, bitPos: c, dirIndex: 0 });

      // 縦: lineId = 15 + col, bitPos = row
      entries.push({ lineId: 15 + c, bitPos: r, dirIndex: 1 });

      // 斜め↘: row-col の範囲は -10..+10 → offset = (row-col) + 10
      const diagSE = r - c;
      if (diagSE >= -10 && diagSE <= 10) {
        const offset = diagSE + 10;
        const lineId = 30 + offset;
        // bitPos: ライン開始点からの距離
        // row-col=d のとき、ライン上の起点は (max(0,d), max(0,-d))
        // bitPos = r - max(0, d) = r - max(0, row-col)
        const bitPos = r - Math.max(0, diagSE);
        entries.push({ lineId, bitPos, dirIndex: 2 });
      }

      // 斜め↗: row+col の範囲は 4..24
      const diagNE = r + c;
      if (diagNE >= 4 && diagNE <= 24) {
        const lineId = 51 + (diagNE - 4);
        // bitPos: ライン開始点からの距離
        // row+col=s のとき、ライン上の起点は (min(s,14), max(0, s-14))
        // ↗方向: row減少・col増加。bitPos = min(s,14) - r
        const bitPos = Math.min(diagNE, 14) - r;
        entries.push({ lineId, bitPos, dirIndex: 3 });
      }

      table[r * BOARD_SIZE + c] = entries;
    }
  }

  return table;
}

function buildLineBitToCell(): Uint16Array {
  const table = new Uint16Array(72 * 16);
  table.fill(0xffff); // sentinel

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cellIndex = r * BOARD_SIZE + c;
      const entries = CELL_TO_LINES[cellIndex] ?? [];
      for (const entry of entries) {
        table[entry.lineId * 16 + entry.bitPos] = cellIndex;
      }
    }
  }

  return table;
}

function buildCellLinesFlat(): Uint16Array {
  const flat = new Uint16Array(225 * 4);
  flat.fill(0xffff); // 未使用スロットのセンチネル値

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const entries = CELL_TO_LINES[r * BOARD_SIZE + c] ?? [];
      for (const entry of entries) {
        flat[(r * BOARD_SIZE + c) * 4 + entry.dirIndex] =
          (entry.lineId << 8) | entry.bitPos;
      }
    }
  }

  return flat;
}
