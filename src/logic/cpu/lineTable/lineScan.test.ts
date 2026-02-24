/**
 * lineScan テスト
 *
 * ライン一括走査エンジンの事前計算データが
 * 既存の analyzeLinePattern / hasFourThreePotentialBit と等価であることを検証。
 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { BOARD_SIZE } from "@/constants";

import {
  getPatternScore,
  getPatternType,
} from "../evaluation/directionAnalysis";
import { getDirectionPattern } from "./adapter";
import { CELL_LINES_FLAT } from "./lineMapping";
import {
  END_STATE_FROM_CODE,
  PACKED_TO_SCORE,
  PACKED_TO_TYPE,
  precomputedBlackFlags,
  precomputedBlackPatterns,
  precomputedWhiteFlags,
  precomputedWhitePatterns,
  precomputeLineFeatures,
  rebuildPackedTables,
  unpackPattern,
} from "./lineScan";
import { buildLineTable } from "./lineTable";
import { hasFourThreePotentialBit } from "./lineThreats";

/** 空盤を生成 */
function emptyBoard(): BoardState {
  return Array.from({ length: BOARD_SIZE }, (): (null | "black" | "white")[] =>
    Array.from({ length: BOARD_SIZE }, (): null => null),
  );
}

/** シード付き擬似乱数生成器 */
function createRng(seed: number): () => number {
  let s = seed;
  return (): number => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff; // eslint-disable-line no-bitwise
    return s / 0x7fffffff;
  };
}

/** ランダム盤面を生成 */
function randomBoard(rng: () => number, stoneCount: number): BoardState {
  const board = emptyBoard();
  const positions: { r: number; c: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      positions.push({ r, c });
    }
  }
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const pi = positions[i];
    const pj = positions[j];
    if (pi && pj) {
      positions[i] = pj;
      positions[j] = pi;
    }
  }
  for (let i = 0; i < stoneCount && i < positions.length; i++) {
    const pos = positions[i];
    if (!pos) {
      continue;
    }
    const { r, c } = pos;
    const row = board[r];
    if (row) {
      row[c] = i % 2 === 0 ? "black" : "white";
    }
  }
  return board;
}

describe("PACKED_TO_SCORE", () => {
  it("256全エントリが getPatternScore と一致", () => {
    for (let packed = 0; packed < 256; packed++) {
      const { count, end1, end2 } = unpackPattern(packed);
      if (count === 0) {
        expect(PACKED_TO_SCORE[packed]).toBe(0);
        continue;
      }
      const expected = getPatternScore({ count, end1, end2 });
      // FIVE(100000) は Int16 clamp されるが、count>=5 は早期リターンで使われない
      if (count >= 5) {
        continue;
      }
      expect(
        PACKED_TO_SCORE[packed],
        `packed=${packed} count=${count} e1=${end1} e2=${end2}`,
      ).toBe(expected);
    }
  });
});

describe("PACKED_TO_TYPE", () => {
  const TYPE_CODE_TO_NAME: Record<number, string | null> = {
    0: null,
    1: "five",
    2: "openFour",
    3: "four",
    4: "openThree",
    5: "three",
    6: "openTwo",
    7: "two",
  };

  it("256全エントリが getPatternType と一致", () => {
    for (let packed = 0; packed < 256; packed++) {
      const { count, end1, end2 } = unpackPattern(packed);
      if (count === 0) {
        expect(PACKED_TO_TYPE[packed]).toBe(0);
        continue;
      }
      const expected = getPatternType({ count, end1, end2 });
      const actual = TYPE_CODE_TO_NAME[PACKED_TO_TYPE[packed] ?? 0] ?? null;
      expect(
        actual,
        `packed=${packed} count=${count} e1=${end1} e2=${end2}`,
      ).toBe(expected);
    }
  });
});

describe("rebuildPackedTables", () => {
  it("再構築後もテーブルが有効", () => {
    rebuildPackedTables();
    // count=4, end1=empty, end2=empty → OPEN_FOUR
    const packed = (4 << 4) | (2 << 2) | 2; // eslint-disable-line no-bitwise
    expect(PACKED_TO_SCORE[packed]).toBe(
      getPatternScore({
        count: 4,
        end1: "empty",
        end2: "empty",
      }),
    );
  });
});

function verifyPrecomputedPatterns(board: BoardState, trial: number): void {
  const lt = buildLineTable(board);
  precomputeLineFeatures(lt.blacks, lt.whites);

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const stone = board[r]?.[c];
      if (stone === null || stone === undefined) {
        continue;
      }

      const patterns =
        stone === "black" ? precomputedBlackPatterns : precomputedWhitePatterns;
      const base = (r * 15 + c) * 4;

      for (let dir = 0; dir < 4; dir++) {
        const flat = CELL_LINES_FLAT[(r * 15 + c) * 4 + dir] ?? 0xffff; // eslint-disable-line no-bitwise
        if (flat === 0xffff) {
          continue;
        }

        const packed = patterns[base + dir] ?? 0;
        const { count, end1, end2 } = unpackPattern(packed);
        const expected = getDirectionPattern(board, r, c, dir, stone, lt);

        expect(count, `board#${trial} (${r},${c}) dir=${dir} count`).toBe(
          expected.count,
        );
        expect(end1, `board#${trial} (${r},${c}) dir=${dir} end1`).toBe(
          expected.end1,
        );
        expect(end2, `board#${trial} (${r},${c}) dir=${dir} end2`).toBe(
          expected.end2,
        );
      }
    }
  }
}

describe("precomputed patterns", () => {
  const RANDOM_BOARD_COUNT = 200;
  const STONE_COUNTS = [6, 10, 16, 24];

  for (const stoneCount of STONE_COUNTS) {
    it(`ランダム盤面 ${RANDOM_BOARD_COUNT}局 (${stoneCount}石) で全占有セル × 全方向が getDirectionPattern と一致`, () => {
      const rng = createRng(stoneCount * 77777);
      for (let trial = 0; trial < RANDOM_BOARD_COUNT; trial++) {
        const board = randomBoard(rng, stoneCount);
        verifyPrecomputedPatterns(board, trial);
      }
    });
  }
});

describe("precomputed flags", () => {
  const RANDOM_BOARD_COUNT = 200;
  const STONE_COUNTS = [6, 10, 16, 24];

  for (const stoneCount of STONE_COUNTS) {
    it(`ランダム盤面 ${RANDOM_BOARD_COUNT}局 (${stoneCount}石) で全空セルの flags が hasFourThreePotentialBit と一致`, () => {
      const rng = createRng(stoneCount * 88888);
      for (let trial = 0; trial < RANDOM_BOARD_COUNT; trial++) {
        const board = randomBoard(rng, stoneCount);
        const lt = buildLineTable(board);
        precomputeLineFeatures(lt.blacks, lt.whites);

        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r]?.[c] !== null) {
              continue;
            }

            for (const color of ["black", "white"] as const) {
              const flags =
                color === "black"
                  ? precomputedBlackFlags
                  : precomputedWhiteFlags;
              const cellIndex = r * 15 + c;
              const f = flags[cellIndex] ?? 0;
              const fourDirs = f & 0x0f; // eslint-disable-line no-bitwise
              const threeDirs = (f >> 4) & 0x0f; // eslint-disable-line no-bitwise
              const hasPotential = Boolean(fourDirs && threeDirs);

              const expected = hasFourThreePotentialBit(
                lt.blacks,
                lt.whites,
                r,
                c,
                color,
              );

              expect(
                hasPotential,
                `board#${trial} (${r},${c}) color=${color}: flags=${f.toString(2).padStart(8, "0")} fourDirs=${fourDirs} threeDirs=${threeDirs} expected=${expected}`,
              ).toBe(expected);
            }
          }
        }
      }
    });
  }
});

describe("fill(0) リセット", () => {
  it("2回連続呼び出しで前回のデータが残らない", () => {
    // 1回目: 石のある盤面
    const board1 = emptyBoard();
    const [, , , , , row5, row6, row7] = board1;
    if (row7) {
      row7[5] = "black";
      row7[6] = "black";
      row7[7] = "black";
    }
    if (row5) {
      row5[4] = "black";
    }
    if (row6) {
      row6[4] = "black";
    }
    const lt1 = buildLineTable(board1);
    precomputeLineFeatures(lt1.blacks, lt1.whites);

    // 何かデータがあることを確認
    const cellIndex1 = 7 * 15 + 5;
    expect(precomputedBlackPatterns[cellIndex1 * 4] ?? 0).not.toBe(0);

    // 2回目: 空盤
    const board2 = emptyBoard();
    const lt2 = buildLineTable(board2);
    precomputeLineFeatures(lt2.blacks, lt2.whites);

    // 前回のデータが残っていないことを確認
    expect(precomputedBlackPatterns[cellIndex1 * 4] ?? 0).toBe(0);
    expect(precomputedWhitePatterns[cellIndex1 * 4] ?? 0).toBe(0);

    // flags も確認
    for (let i = 0; i < 225; i++) {
      expect(precomputedBlackFlags[i]).toBe(0);
      expect(precomputedWhiteFlags[i]).toBe(0);
    }
  });
});

describe("END_STATE_FROM_CODE", () => {
  it("正しいマッピング", () => {
    expect(END_STATE_FROM_CODE[0]).toBe("edge");
    expect(END_STATE_FROM_CODE[1]).toBe("opponent");
    expect(END_STATE_FROM_CODE[2]).toBe("empty");
  });
});
