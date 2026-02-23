import { describe, expect, it } from "vitest";

import type {
  GameResult,
  MoveRecord,
} from "../../src/logic/cpu/benchmark/headless.ts";
import type {
  ForbiddenVulnerabilityWeakness,
  TimePressureErrorWeakness,
} from "../types/weakness.ts";

import {
  analyzeGameWeaknesses,
  summarizePatterns,
} from "./weaknessAnalyzer.ts";

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

  it("interrupted でないケース → TPE 非検出", () => {
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

// ============================================================================
// forbidden-vulnerability 分類
// ============================================================================

describe("forbidden-vulnerability 分類: subType", () => {
  it("forcedForbidden=true → subType: forced-trap", () => {
    // 10手目（白番）で禁手追い込み成立、11手目（黒番）が禁手で敗北
    const moveHistory: MoveRecord[] = [];
    for (let i = 0; i < 10; i++) {
      moveHistory.push(createMockMoveRecord({ row: i, col: i }));
    }
    // 最終手: 黒が禁手を打たされた
    moveHistory.push(
      createMockMoveRecord({
        row: 5,
        col: 5,
        forcedForbidden: true,
      }),
    );

    const game = createMockGameResult({
      winner: "B", // 白の勝ち
      reason: "forbidden",
      moves: 11,
      moveHistory,
    });

    const weaknesses = analyzeGameWeaknesses(game, 0);
    const fvs = weaknesses.filter(
      (w): w is ForbiddenVulnerabilityWeakness =>
        w.type === "forbidden-vulnerability",
    );
    expect(fvs).toHaveLength(1);
    expect(fvs[0]?.subType).toBe("forced-trap");
  });

  it("forcedForbidden=false → subType: self-inflicted", () => {
    // 黒が自滅禁手
    const moveHistory: MoveRecord[] = [];
    for (let i = 0; i < 8; i++) {
      moveHistory.push(createMockMoveRecord({ row: i, col: i }));
    }
    moveHistory.push(
      createMockMoveRecord({
        row: 5,
        col: 5,
        // forcedForbidden: undefined (デフォルト = false扱い)
      }),
    );

    const game = createMockGameResult({
      winner: "B",
      reason: "forbidden",
      moves: 9,
      moveHistory,
    });

    const weaknesses = analyzeGameWeaknesses(game, 0);
    const fvs = weaknesses.filter(
      (w): w is ForbiddenVulnerabilityWeakness =>
        w.type === "forbidden-vulnerability",
    );
    expect(fvs).toHaveLength(1);
    expect(fvs[0]?.subType).toBe("self-inflicted");
  });

  it("弱点リストには forced-trap も含まれる", () => {
    const moveHistory: MoveRecord[] = [];
    for (let i = 0; i < 10; i++) {
      moveHistory.push(createMockMoveRecord({ row: i, col: i }));
    }
    moveHistory.push(
      createMockMoveRecord({ row: 5, col: 5, forcedForbidden: true }),
    );

    const game = createMockGameResult({
      winner: "B",
      reason: "forbidden",
      moves: 11,
      moveHistory,
    });

    const weaknesses = analyzeGameWeaknesses(game, 0);
    // forced-trap も弱点リストに含まれる（情報保持）
    expect(
      weaknesses.some(
        (w) =>
          w.type === "forbidden-vulnerability" &&
          (w as ForbiddenVulnerabilityWeakness).subType === "forced-trap",
      ),
    ).toBe(true);
  });
});

describe("summarizePatterns: forbidden-vulnerability の集計", () => {
  it("self-inflicted のみ集計カウントに含まれる", () => {
    const weaknesses: ForbiddenVulnerabilityWeakness[] = [
      {
        type: "forbidden-vulnerability",
        gameIndex: 0,
        moveNumber: 11,
        color: "black",
        position: { row: 5, col: 5 },
        trapMoveNumber: 11,
        subType: "forced-trap",
        description: "手11: 白の禁手追い込みで黒が敗北",
      },
      {
        type: "forbidden-vulnerability",
        gameIndex: 1,
        moveNumber: 9,
        color: "black",
        position: { row: 3, col: 3 },
        trapMoveNumber: 9,
        subType: "self-inflicted",
        description: "手9: 黒が禁手を自滅的に着手",
      },
    ];

    const patterns = summarizePatterns(weaknesses, 10);
    const fvPattern = patterns.find(
      (p) => p.type === "forbidden-vulnerability",
    );

    // self-inflicted の 1件のみカウント（forced-trap は除外）
    expect(fvPattern?.count).toBe(1);
    expect(fvPattern?.rate).toBe(0.1);
  });

  it("forced-trap のみの場合、集計カウントは 0", () => {
    const weaknesses: ForbiddenVulnerabilityWeakness[] = [
      {
        type: "forbidden-vulnerability",
        gameIndex: 0,
        moveNumber: 11,
        color: "black",
        position: { row: 5, col: 5 },
        trapMoveNumber: 11,
        subType: "forced-trap",
        description: "手11: 白の禁手追い込みで黒が敗北",
      },
    ];

    const patterns = summarizePatterns(weaknesses, 10);
    const fvPattern = patterns.find(
      (p) => p.type === "forbidden-vulnerability",
    );

    expect(fvPattern?.count).toBe(0);
    expect(fvPattern?.rate).toBe(0);
  });
});
