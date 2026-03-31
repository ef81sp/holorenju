/* eslint-disable no-bitwise -- WASM packed return values require bitwise ops */

/**
 * WASM パリティテスト
 *
 * TS版の countInDirection / analyzeDirection / getPatternScore / evaluateStonePatterns と
 * WASM版の出力が一致することを確認
 */

import { describe, expect, it } from "vitest";

import { DIRECTIONS } from "../core/constants";
import {
  analyzeDirection,
  countInDirection,
  getPatternScore,
  getPatternType,
} from "../evaluation/directionAnalysis";
import { PATTERN_SCORES } from "../evaluation/patternScores";
import { createBoardWithStones } from "../testUtils";
import { boardStateToWasm, colorToWasm } from "./boardAdapter";
import { loadWasmModule } from "./loader";
import { type WasmModuleContext, END_STATE } from "./types";

const END_STATE_MAP = {
  empty: END_STATE.EMPTY,
  opponent: END_STATE.OPPONENT,
  edge: END_STATE.EDGE,
} as const;

function unpackCount16(packed: number): { count: number; endState: number } {
  return { count: packed >> 8, endState: packed & 0xff };
}

function unpackAnalyze32(packed: number): {
  count: number;
  end1: number;
  end2: number;
} {
  return {
    count: (packed >> 16) & 0xff,
    end1: (packed >> 8) & 0xff,
    end2: packed & 0xff,
  };
}

const PATTERN_TYPE_MAP: Record<string, number> = {
  five: 1,
  openFour: 2,
  four: 3,
  openThree: 4,
  three: 5,
  openTwo: 6,
  two: 7,
};

describe("WASM parity tests", async () => {
  const wasm: WasmModuleContext = await loadWasmModule();

  describe("countInDirection parity", () => {
    it("右方向に2つの黒石", () => {
      const board = createBoardWithStones([
        { row: 7, col: 7, color: "black" },
        { row: 7, col: 8, color: "black" },
        { row: 7, col: 9, color: "black" },
      ]);
      const ts = countInDirection(board, 7, 7, 0, 1, "black");
      boardStateToWasm(wasm, board);
      const w = unpackCount16(
        wasm.countInDirection(7, 7, 0, 1, colorToWasm("black")),
      );
      expect(w.count).toBe(ts.count);
      expect(w.endState).toBe(END_STATE_MAP[ts.endState]);
    });

    it("端が相手の石", () => {
      const board = createBoardWithStones([
        { row: 7, col: 7, color: "black" },
        { row: 7, col: 8, color: "black" },
        { row: 7, col: 9, color: "white" },
      ]);
      const ts = countInDirection(board, 7, 7, 0, 1, "black");
      boardStateToWasm(wasm, board);
      const w = unpackCount16(
        wasm.countInDirection(7, 7, 0, 1, colorToWasm("black")),
      );
      expect(w.count).toBe(ts.count);
      expect(w.endState).toBe(END_STATE_MAP[ts.endState]);
    });

    it("端が盤端", () => {
      const board = createBoardWithStones([
        { row: 7, col: 13, color: "black" },
        { row: 7, col: 14, color: "black" },
      ]);
      const ts = countInDirection(board, 7, 13, 0, 1, "black");
      boardStateToWasm(wasm, board);
      const w = unpackCount16(
        wasm.countInDirection(7, 13, 0, 1, colorToWasm("black")),
      );
      expect(w.count).toBe(ts.count);
      expect(w.endState).toBe(END_STATE_MAP[ts.endState]);
    });
  });

  describe("analyzeDirection parity", () => {
    it("活四（両端開）", () => {
      const board = createBoardWithStones([
        { row: 7, col: 5, color: "black" },
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
        { row: 7, col: 8, color: "black" },
      ]);
      const ts = analyzeDirection(board, 7, 7, 0, 1, "black");
      boardStateToWasm(wasm, board);
      const w = unpackAnalyze32(
        wasm.analyzeDirection(7, 7, 0, 1, colorToWasm("black")),
      );
      expect(w.count).toBe(ts.count);
      expect(w.end1).toBe(END_STATE_MAP[ts.end1]);
      expect(w.end2).toBe(END_STATE_MAP[ts.end2]);
    });

    it("片端塞がり三連", () => {
      const board = createBoardWithStones([
        { row: 7, col: 4, color: "white" },
        { row: 7, col: 5, color: "black" },
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
      ]);
      const ts = analyzeDirection(board, 7, 6, 0, 1, "black");
      boardStateToWasm(wasm, board);
      const w = unpackAnalyze32(
        wasm.analyzeDirection(7, 6, 0, 1, colorToWasm("black")),
      );
      expect(w.count).toBe(ts.count);
      expect(w.end1).toBe(END_STATE_MAP[ts.end1]);
      expect(w.end2).toBe(END_STATE_MAP[ts.end2]);
    });

    it("斜め方向", () => {
      const board = createBoardWithStones([
        { row: 5, col: 5, color: "white" },
        { row: 6, col: 6, color: "white" },
        { row: 7, col: 7, color: "white" },
      ]);
      const ts = analyzeDirection(board, 6, 6, 1, 1, "white");
      boardStateToWasm(wasm, board);
      const w = unpackAnalyze32(
        wasm.analyzeDirection(6, 6, 1, 1, colorToWasm("white")),
      );
      expect(w.count).toBe(ts.count);
      expect(w.end1).toBe(END_STATE_MAP[ts.end1]);
      expect(w.end2).toBe(END_STATE_MAP[ts.end2]);
    });
  });

  describe("getPatternScore parity", () => {
    it.each([
      [5, "empty", "empty"],
      [4, "empty", "empty"],
      [4, "empty", "opponent"],
      [4, "opponent", "opponent"],
      [3, "empty", "empty"],
      [3, "empty", "edge"],
      [3, "opponent", "opponent"],
      [2, "empty", "empty"],
      [2, "empty", "opponent"],
      [6, "empty", "empty"],
      [1, "empty", "empty"],
    ] as const)("count=%i, end1=%s, end2=%s", (count, end1, end2) => {
      const ts = getPatternScore({ count, end1, end2 });
      const w = wasm.wasmGetPatternScore(
        count,
        END_STATE_MAP[end1],
        END_STATE_MAP[end2],
      );
      expect(w).toBe(ts);
    });
  });

  describe("getPatternType parity", () => {
    it.each([
      [5, "empty", "empty"],
      [4, "empty", "empty"],
      [4, "empty", "opponent"],
      [4, "opponent", "opponent"],
      [3, "empty", "empty"],
      [1, "empty", "empty"],
    ] as const)("count=%i, end1=%s, end2=%s", (count, end1, end2) => {
      const ts = getPatternType({ count, end1, end2 });
      const w = wasm.wasmGetPatternType(
        count,
        END_STATE_MAP[end1],
        END_STATE_MAP[end2],
      );
      const expected = ts === null ? 0 : PATTERN_TYPE_MAP[ts];
      expect(w).toBe(expected);
    });
  });

  describe("evaluateDirectionScores parity (no jump patterns)", () => {
    it("活三横", () => {
      const board = createBoardWithStones([
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
        { row: 7, col: 8, color: "black" },
      ]);
      const ts = computeTsDirectionScores(board, 7, 7, "black");
      boardStateToWasm(wasm, board);
      expect(wasm.evaluateDirectionScores(7, 7, colorToWasm("black"))).toBe(ts);
    });

    it("二方向パターン", () => {
      const board = createBoardWithStones([
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
        { row: 7, col: 8, color: "black" },
        { row: 6, col: 7, color: "black" },
        { row: 8, col: 7, color: "black" },
      ]);
      const ts = computeTsDirectionScores(board, 7, 7, "black");
      boardStateToWasm(wasm, board);
      expect(wasm.evaluateDirectionScores(7, 7, colorToWasm("black"))).toBe(ts);
    });

    it("白の止め四", () => {
      const board = createBoardWithStones([
        { row: 3, col: 3, color: "white" },
        { row: 3, col: 4, color: "white" },
        { row: 3, col: 5, color: "white" },
        { row: 3, col: 6, color: "white" },
        { row: 3, col: 2, color: "black" },
      ]);
      const ts = computeTsDirectionScores(board, 3, 5, "white");
      boardStateToWasm(wasm, board);
      expect(wasm.evaluateDirectionScores(3, 5, colorToWasm("white"))).toBe(ts);
    });
  });

  describe("black overline correction parity", () => {
    it("黒4連の先に黒石がある場合、端を塞がりとして扱う", () => {
      const board = createBoardWithStones([
        { row: 7, col: 5, color: "black" },
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
        { row: 7, col: 8, color: "black" },
        { row: 7, col: 10, color: "black" },
      ]);
      const ts = analyzeDirection(board, 7, 7, 0, 1, "black");
      boardStateToWasm(wasm, board);
      const w = unpackAnalyze32(
        wasm.analyzeDirection(7, 7, 0, 1, colorToWasm("black")),
      );
      expect(w.end1).toBe(END_STATE_MAP[ts.end1]);
      expect(w.end2).toBe(END_STATE_MAP[ts.end2]);
    });
  });
});

function computeTsDirectionScores(
  board: ReturnType<typeof createBoardWithStones>,
  row: number,
  col: number,
  color: "black" | "white",
): number {
  let score = 0;
  for (let i = 0; i < DIRECTIONS.length; i++) {
    const [dr, dc] = DIRECTIONS[i]!;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);
    let dirScore = getPatternScore(pattern);
    if ((i === 2 || i === 3) && dirScore > 0) {
      dirScore = Math.round(
        dirScore * PATTERN_SCORES.DIAGONAL_BONUS_MULTIPLIER,
      );
    }
    score += dirScore;
  }
  return score;
}
