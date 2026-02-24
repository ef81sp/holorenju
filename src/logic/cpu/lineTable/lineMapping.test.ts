/**
 * lineMapping テスト
 *
 * セル座標 → ライン情報のマッピングを検証する。
 */

import { describe, expect, it } from "vitest";

import {
  CELL_LINES_FLAT,
  CELL_TO_LINES,
  LINE_BIT_TO_CELL,
  LINE_LENGTHS,
  getCellLines,
  getDirIndexFromLineId,
} from "./lineMapping";

describe("LINE_LENGTHS", () => {
  it("72本のラインが定義されている", () => {
    expect(LINE_LENGTHS).toHaveLength(72);
  });

  it("横ライン (0~14) は長さ15", () => {
    for (let i = 0; i < 15; i++) {
      expect(LINE_LENGTHS[i]).toBe(15);
    }
  });

  it("縦ライン (15~29) は長さ15", () => {
    for (let i = 15; i < 30; i++) {
      expect(LINE_LENGTHS[i]).toBe(15);
    }
  });

  it("斜め↘ライン (30~50) の長さが幾何に一致", () => {
    // row - col = -10..+10 → 中央(offset=10)が最長15
    // offset=0: row-col=-10 → 長さ5
    // offset=10: row-col=0 → 長さ15
    // offset=20: row-col=+10 → 長さ5
    for (let i = 0; i < 21; i++) {
      const lineId = 30 + i;
      const expected = 15 - Math.abs(i - 10);
      expect(LINE_LENGTHS[lineId]).toBe(expected);
    }
  });

  it("斜め↗ライン (51~71) の長さが幾何に一致", () => {
    // row + col = 4..24 → 中央(sum=14)が最長15
    // sum=4: 長さ5, sum=14: 長さ15, sum=24: 長さ5
    for (let i = 0; i < 21; i++) {
      const lineId = 51 + i;
      const sum = i + 4;
      const expected = sum <= 14 ? sum + 1 : 29 - sum;
      expect(LINE_LENGTHS[lineId]).toBe(expected);
    }
  });

  it("全ラインの長さが5~15の範囲", () => {
    for (let i = 0; i < 72; i++) {
      expect(LINE_LENGTHS[i]).toBeGreaterThanOrEqual(5);
      expect(LINE_LENGTHS[i]).toBeLessThanOrEqual(15);
    }
  });
});

describe("CELL_TO_LINES / getCellLines", () => {
  it("全225セルのエントリ数が2~4", () => {
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        const entries = getCellLines(r, c);
        expect(entries.length).toBeGreaterThanOrEqual(2);
        expect(entries.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it("中央セル (7,7) で4エントリ・4方向", () => {
    const entries = getCellLines(7, 7);
    expect(entries).toHaveLength(4);

    const dirIndices = entries.map((e) => e.dirIndex).sort();
    expect(dirIndices).toEqual([0, 1, 2, 3]);
  });

  it("中央セル (7,7) の lineId/bitPos が正しい", () => {
    const entries = getCellLines(7, 7);
    const byDir = Object.fromEntries(entries.map((e) => [e.dirIndex, e]));

    // 横: lineId=7 (row=7), bitPos=7 (col=7)
    expect(byDir[0]).toMatchObject({ lineId: 7, bitPos: 7 });
    // 縦: lineId=22 (15+col=7), bitPos=7 (row=7)
    expect(byDir[1]).toMatchObject({ lineId: 22, bitPos: 7 });
    // 斜め↘: row-col=0 → offset=10 → lineId=40, bitPos=7
    expect(byDir[2]).toMatchObject({ lineId: 40, bitPos: 7 });
    // 斜め↗: row+col=14 → sum-4=10 → lineId=61, bitPos=7
    expect(byDir[3]).toMatchObject({ lineId: 61, bitPos: 7 });
  });

  it("角セル (0,0) は斜め↗がない（row+col=0 < 4）", () => {
    const entries = getCellLines(0, 0);
    const dirIndices = entries.map((e) => e.dirIndex);
    expect(dirIndices).toContain(0); // 横
    expect(dirIndices).toContain(1); // 縦
    expect(dirIndices).toContain(2); // 斜め↘
    expect(dirIndices).not.toContain(3); // 斜め↗なし
  });

  it("角セル (0,0) の lineId/bitPos が正しい", () => {
    const entries = getCellLines(0, 0);
    const byDir = Object.fromEntries(entries.map((e) => [e.dirIndex, e]));

    // 横: lineId=0, bitPos=0
    expect(byDir[0]).toMatchObject({ lineId: 0, bitPos: 0 });
    // 縦: lineId=15, bitPos=0
    expect(byDir[1]).toMatchObject({ lineId: 15, bitPos: 0 });
    // 斜め↘: row-col=0 → offset=10 → lineId=40, bitPos=0
    expect(byDir[2]).toMatchObject({ lineId: 40, bitPos: 0 });
  });

  it("角セル (14,14) の lineId/bitPos が正しい", () => {
    const entries = getCellLines(14, 14);
    const byDir = Object.fromEntries(entries.map((e) => [e.dirIndex, e]));

    // 横: lineId=14, bitPos=14
    expect(byDir[0]).toMatchObject({ lineId: 14, bitPos: 14 });
    // 縦: lineId=29, bitPos=14
    expect(byDir[1]).toMatchObject({ lineId: 29, bitPos: 14 });
    // 斜め↘: row-col=0 → offset=10 → lineId=40, bitPos=14
    expect(byDir[2]).toMatchObject({ lineId: 40, bitPos: 14 });
    // 斜め↗: row+col=28 > 24 → なし
    expect(byDir[3]).toBeUndefined();
  });

  it("角セル (0,14) は斜め↘がない（row-col=-14 < -10）", () => {
    const entries = getCellLines(0, 14);
    const dirIndices = entries.map((e) => e.dirIndex);
    expect(dirIndices).toContain(0); // 横
    expect(dirIndices).toContain(1); // 縦
    expect(dirIndices).not.toContain(2); // 斜め↘なし
    expect(dirIndices).toContain(3); // 斜め↗
  });

  it("同一セル内でlineIdが重複しない", () => {
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        const entries = getCellLines(r, c);
        const lineIds = entries.map((e) => e.lineId);
        expect(new Set(lineIds).size).toBe(lineIds.length);
      }
    }
  });

  it("同一セル内でdirIndexが重複しない", () => {
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        const entries = getCellLines(r, c);
        const dirIndices = entries.map((e) => e.dirIndex);
        expect(new Set(dirIndices).size).toBe(dirIndices.length);
      }
    }
  });

  it("getCellLines は CELL_TO_LINES と同じ参照を返す", () => {
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        expect(getCellLines(r, c)).toBe(CELL_TO_LINES[r * 15 + c]);
      }
    }
  });

  it("bitPos が各ラインの長さ範囲内", () => {
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        const entries = getCellLines(r, c);
        for (const entry of entries) {
          expect(entry.bitPos).toBeGreaterThanOrEqual(0);
          expect(entry.bitPos).toBeLessThan(LINE_LENGTHS[entry.lineId]!);
        }
      }
    }
  });
});

describe("CELL_LINES_FLAT", () => {
  it("サイズが 225*4 = 900", () => {
    expect(CELL_LINES_FLAT).toHaveLength(900);
  });

  it("getCellLines と全セルで一致", () => {
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        const entries = getCellLines(r, c);
        for (const entry of entries) {
          const packed = CELL_LINES_FLAT[(r * 15 + c) * 4 + entry.dirIndex]!;
          // eslint-disable-next-line no-bitwise
          const lineId = packed >> 8;
          // eslint-disable-next-line no-bitwise
          const bitPos = packed & 0xff;
          expect(lineId).toBe(entry.lineId);
          expect(bitPos).toBe(entry.bitPos);
        }
      }
    }
  });

  it("エントリなし方向は 0xFFFF", () => {
    // (0,0) は dirIndex=3 (↗) がない
    const packed = CELL_LINES_FLAT[(0 * 15 + 0) * 4 + 3]!;
    expect(packed).toBe(0xffff);
  });
});

describe("LINE_BIT_TO_CELL", () => {
  it("全225セル × 全方向で CELL_TO_LINES と逆引きが一致", () => {
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        const cellIndex = r * 15 + c;
        const entries = CELL_TO_LINES[cellIndex]!;
        for (const entry of entries) {
          const result = LINE_BIT_TO_CELL[entry.lineId * 16 + entry.bitPos]!;
          expect(
            result,
            `cell(${r},${c}) lineId=${entry.lineId} bitPos=${entry.bitPos}`,
          ).toBe(cellIndex);
        }
      }
    }
  });

  it("sentinel (0xFFFF) が LINE_LENGTHS 超過のビット位置にのみ存在する", () => {
    for (let lineId = 0; lineId < 72; lineId++) {
      const len = LINE_LENGTHS[lineId]!;
      // ライン範囲内は有効なセルインデックス
      for (let bitPos = 0; bitPos < len; bitPos++) {
        const val = LINE_BIT_TO_CELL[lineId * 16 + bitPos]!;
        expect(
          val,
          `lineId=${lineId} bitPos=${bitPos} should not be sentinel`,
        ).not.toBe(0xffff);
        expect(val).toBeLessThan(225);
      }
      // ライン範囲外は sentinel
      for (let bitPos = len; bitPos < 16; bitPos++) {
        const val = LINE_BIT_TO_CELL[lineId * 16 + bitPos]!;
        expect(
          val,
          `lineId=${lineId} bitPos=${bitPos} should be sentinel`,
        ).toBe(0xffff);
      }
    }
  });
});

describe("getDirIndexFromLineId", () => {
  it("横ライン (0~14) → 0", () => {
    for (let i = 0; i < 15; i++) {
      expect(getDirIndexFromLineId(i)).toBe(0);
    }
  });

  it("縦ライン (15~29) → 1", () => {
    for (let i = 15; i < 30; i++) {
      expect(getDirIndexFromLineId(i)).toBe(1);
    }
  });

  it("斜め↘ (30~50) → 2", () => {
    for (let i = 30; i < 51; i++) {
      expect(getDirIndexFromLineId(i)).toBe(2);
    }
  });

  it("斜め↗ (51~71) → 3", () => {
    for (let i = 51; i < 72; i++) {
      expect(getDirIndexFromLineId(i)).toBe(3);
    }
  });
});
