import { describe, expect, it } from "vitest";

import type {
  GameResult,
  MoveRecord,
} from "../../src/logic/cpu/benchmark/headless.ts";
import type { TimePressureErrorWeakness } from "../types/weakness.ts";

import { analyzeGameWeaknesses } from "./weaknessAnalyzer.ts";

/**
 * MoveRecord のモックを作成するヘルパー
 */
function createMockMoveRecord(overrides: Partial<MoveRecord> = {}): MoveRecord {
  return {
    row: 7,
    col: 7,
    time: 1000,
    isOpening: false,
    ...overrides,
  };
}

/**
 * GameResult のモックを作成するヘルパー
 */
function createMockGameResult(overrides: Partial<GameResult> = {}): GameResult {
  return {
    playerA: "A",
    playerB: "B",
    winner: "A",
    reason: "five",
    moves: 10,
    duration: 10000,
    moveHistory: [],
    isABlack: true,
    ...overrides,
  };
}

describe("TPE検出: timePressureFallback による除外", () => {
  it("timePressureFallback=true + interrupted + スコア悪化 → TPE非検出", () => {
    const game = createMockGameResult({
      moveHistory: [
        createMockMoveRecord({ score: 100 }),
        createMockMoveRecord({
          score: -50,
          timePressureFallback: true,
          stats: {
            interrupted: true,
            completedDepth: 3,
            maxDepth: 6,
            nodes: 100000,
            ttHits: 500,
          },
          depthHistory: [
            { depth: 3, position: { row: 7, col: 8 }, score: 200 },
            { depth: 4, position: { row: 7, col: 6 }, score: 50 },
          ],
        }),
      ],
    });

    const weaknesses = analyzeGameWeaknesses(game, 0);
    const tpes = weaknesses.filter((w) => w.type === "time-pressure-error");
    expect(tpes).toHaveLength(0);
  });

  it("timePressureFallback=undefined + interrupted + スコア悪化 → TPE検出", () => {
    const game = createMockGameResult({
      moveHistory: [
        createMockMoveRecord({ score: 100 }),
        createMockMoveRecord({
          score: -50,
          // timePressureFallback: undefined (デフォルト)
          stats: {
            interrupted: true,
            completedDepth: 3,
            maxDepth: 6,
            nodes: 100000,
            ttHits: 500,
          },
          depthHistory: [
            { depth: 3, position: { row: 7, col: 8 }, score: 200 },
            { depth: 4, position: { row: 7, col: 6 }, score: 50 },
          ],
        }),
      ],
    });

    const weaknesses = analyzeGameWeaknesses(game, 0);
    const tpes = weaknesses.filter(
      (w): w is TimePressureErrorWeakness => w.type === "time-pressure-error",
    );
    expect(tpes).toHaveLength(1);
    expect(tpes[0]?.previousDepthScore).toBe(200);
    expect(tpes[0]?.finalScore).toBe(50);
  });

  it("interrupted でないケース → TPE非検出", () => {
    const game = createMockGameResult({
      moveHistory: [
        createMockMoveRecord({ score: 100 }),
        createMockMoveRecord({
          score: -50,
          stats: {
            interrupted: false,
            completedDepth: 6,
            maxDepth: 6,
            nodes: 100000,
            ttHits: 500,
          },
          depthHistory: [
            { depth: 5, position: { row: 7, col: 8 }, score: 200 },
            { depth: 6, position: { row: 7, col: 6 }, score: 50 },
          ],
        }),
      ],
    });

    const weaknesses = analyzeGameWeaknesses(game, 0);
    const tpes = weaknesses.filter((w) => w.type === "time-pressure-error");
    expect(tpes).toHaveLength(0);
  });
});
