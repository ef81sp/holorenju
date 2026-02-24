/**
 * 事前計算版の等価性テスト
 *
 * evaluateStonePatternsPrecomputed, scanFourThreeThreatFromFlags,
 * createsFourThreeBit が従来版と完全に一致することを検証。
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { BOARD_SIZE } from "@/constants";

import {
  precomputedBlackFlags,
  precomputedBlackPatterns,
  precomputedWhiteFlags,
  precomputedWhitePatterns,
  precomputeLineFeatures,
} from "../lineTable/lineScan";
import { buildLineTable } from "../lineTable/lineTable";
import { hasFourThreePotentialBit } from "../lineTable/lineThreats";
import {
  evaluateStonePatternsLight,
  evaluateStonePatternsPrecomputed,
} from "./stonePatterns";
import { createsFourThree, createsFourThreeBit } from "./winningPatterns";

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
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
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
    [positions[i], positions[j]] = [positions[j]!, positions[i]!];
  }
  for (let i = 0; i < stoneCount && i < positions.length; i++) {
    const { r, c } = positions[i]!;
    board[r]![c] = i % 2 === 0 ? "black" : "white";
  }
  return board;
}

describe("evaluateStonePatternsPrecomputed vs evaluateStonePatternsLight", () => {
  const RANDOM_BOARD_COUNT = 200;
  const STONE_COUNTS = [6, 10, 16, 24];

  for (const stoneCount of STONE_COUNTS) {
    it(`ランダム盤面 ${RANDOM_BOARD_COUNT}局 (${stoneCount}石) で完全一致`, () => {
      const rng = createRng(stoneCount * 99999);
      for (let trial = 0; trial < RANDOM_BOARD_COUNT; trial++) {
        const board = randomBoard(rng, stoneCount);
        const lt = buildLineTable(board);
        precomputeLineFeatures(lt.blacks, lt.whites);

        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            const stone = board[r]?.[c];
            if (stone === null || stone === undefined) {
              continue;
            }

            const patterns =
              stone === "black"
                ? precomputedBlackPatterns
                : precomputedWhitePatterns;
            const expected = evaluateStonePatternsLight(board, r, c, stone, lt);
            const actual = evaluateStonePatternsPrecomputed(
              board,
              r,
              c,
              stone,
              patterns,
            );

            expect(
              actual.score,
              `board#${trial} (${r},${c}) ${stone} score`,
            ).toBe(expected.score);
            expect(
              actual.fourScore,
              `board#${trial} (${r},${c}) ${stone} fourScore`,
            ).toBe(expected.fourScore);
            expect(
              actual.openThreeScore,
              `board#${trial} (${r},${c}) ${stone} openThreeScore`,
            ).toBe(expected.openThreeScore);
            expect(
              actual.activeDirectionCount,
              `board#${trial} (${r},${c}) ${stone} activeDirectionCount`,
            ).toBe(expected.activeDirectionCount);
          }
        }
      }
    });
  }
});

describe("createsFourThreeBit vs createsFourThree", () => {
  const RANDOM_BOARD_COUNT = 200;
  const STONE_COUNTS = [6, 10, 16, 24];

  for (const stoneCount of STONE_COUNTS) {
    it(`ランダム盤面 ${RANDOM_BOARD_COUNT}局 (${stoneCount}石) で完全一致`, () => {
      const rng = createRng(stoneCount * 11111);
      for (let trial = 0; trial < RANDOM_BOARD_COUNT; trial++) {
        const board = randomBoard(rng, stoneCount);
        const lt = buildLineTable(board);

        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r]?.[c] !== null) {
              continue;
            }

            for (const color of ["black", "white"] as const) {
              const expected = createsFourThree(board, r, c, color);
              const actual = createsFourThreeBit(board, lt, r, c, color);

              expect(
                actual,
                `board#${trial} (${r},${c}) ${color}: expected=${expected} actual=${actual}`,
              ).toBe(expected);
            }
          }
        }
      }
    });
  }
});

describe("scanFourThreeThreatFromFlags vs scanFourThreeThreat", () => {
  /** 盤面の石数をカウント */
  function countStones(board: BoardState, color: "black" | "white"): number {
    let count = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r]?.[c] === color) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * 旧 scanFourThreeThreat (lineTable パス)
   * hasFourThreePotentialBit + createsFourThree
   */
  function scanFourThreeThreatOld(
    board: BoardState,
    color: "black" | "white",
    stoneCount: number,
  ): boolean {
    if (stoneCount < 5) {
      return false;
    }
    const lt = buildLineTable(board);
    for (let r = 0; r < BOARD_SIZE; r++) {
      const rowOccupied = lt.blacks[r]! | lt.whites[r]!;
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (rowOccupied & (1 << c)) {
          continue;
        }
        if (!hasFourThreePotentialBit(lt.blacks, lt.whites, r, c, color)) {
          continue;
        }
        if (createsFourThree(board, r, c, color)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 新 scanFourThreeThreatFromFlags
   * precomputed flags + createsFourThreeBit
   */
  function scanFourThreaThreatNew(
    board: BoardState,
    color: "black" | "white",
    stoneCount: number,
  ): boolean {
    if (stoneCount < 5) {
      return false;
    }
    const lt = buildLineTable(board);
    precomputeLineFeatures(lt.blacks, lt.whites);
    const flags =
      color === "black" ? precomputedBlackFlags : precomputedWhiteFlags;
    for (let i = 0; i < 225; i++) {
      const f = flags[i]!;
      if (f === 0) {
        continue;
      }
      const fourDirs = f & 0x0f;
      const threeDirs = (f >> 4) & 0x0f;
      if (fourDirs && threeDirs) {
        const row = (i / 15) | 0;
        const col = i % 15;
        if (createsFourThreeBit(board, lt, row, col, color)) {
          return true;
        }
      }
    }
    return false;
  }

  const RANDOM_BOARD_COUNT = 200;
  const STONE_COUNTS = [6, 10, 16, 24];

  for (const stoneCount of STONE_COUNTS) {
    it(`ランダム盤面 ${RANDOM_BOARD_COUNT}局 (${stoneCount}石) で完全一致`, () => {
      const rng = createRng(stoneCount * 22222);
      for (let trial = 0; trial < RANDOM_BOARD_COUNT; trial++) {
        const board = randomBoard(rng, stoneCount);
        for (const color of ["black", "white"] as const) {
          const sc = countStones(board, color);
          const expected = scanFourThreeThreatOld(board, color, sc);
          const actual = scanFourThreaThreatNew(board, color, sc);
          expect(
            actual,
            `board#${trial} ${color}: old=${expected} new=${actual}`,
          ).toBe(expected);
        }
      }
    });
  }
});
