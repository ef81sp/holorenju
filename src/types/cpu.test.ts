/**
 * CPU対戦関連の型定義テスト
 */

import { describe, expect, it } from "vitest";

import {
  CPU_DIFFICULTIES,
  DIFFICULTY_PARAMS,
  isCpuDifficulty,
  type CpuRequest,
  type CpuResponse,
  type CpuBattleRecord,
  type CpuBattleStats,
  type CpuDifficulty,
} from "./cpu";

describe("CpuDifficulty", () => {
  it("CPU_DIFFICULTIESは4つの難易度を持つ", () => {
    expect(CPU_DIFFICULTIES).toHaveLength(4);
    expect(CPU_DIFFICULTIES).toContain("beginner");
    expect(CPU_DIFFICULTIES).toContain("easy");
    expect(CPU_DIFFICULTIES).toContain("medium");
    expect(CPU_DIFFICULTIES).toContain("hard");
  });

  it("isCpuDifficultyで難易度を判定できる", () => {
    expect(isCpuDifficulty("beginner")).toBe(true);
    expect(isCpuDifficulty("easy")).toBe(true);
    expect(isCpuDifficulty("medium")).toBe(true);
    expect(isCpuDifficulty("hard")).toBe(true);
    expect(isCpuDifficulty("invalid")).toBe(false);
    expect(isCpuDifficulty("")).toBe(false);
  });
});

describe("DifficultyParams", () => {
  it("各難易度にパラメータが設定されている", () => {
    const difficulties: CpuDifficulty[] = [
      "beginner",
      "easy",
      "medium",
      "hard",
    ];

    for (const difficulty of difficulties) {
      const params = DIFFICULTY_PARAMS[difficulty];
      expect(params).toBeDefined();
      expect(typeof params.depth).toBe("number");
      expect(typeof params.timeLimit).toBe("number");
      expect(typeof params.randomFactor).toBe("number");
      expect(typeof params.maxNodes).toBe("number");
    }
  });
});

describe("CpuRequest/CpuResponse型", () => {
  it("CpuRequestを構築できる", () => {
    const request: CpuRequest = {
      board: new Array(15).fill(null).map(() => new Array(15).fill(null)),
      currentTurn: "black",
      difficulty: "medium",
    };

    expect(request.board).toHaveLength(15);
    expect(request.currentTurn).toBe("black");
    expect(request.difficulty).toBe("medium");
  });

  it("CpuResponseを構築できる", () => {
    const response: CpuResponse = {
      position: { row: 7, col: 7 },
      score: 100,
      thinkingTime: 500,
      depth: 4,
    };

    expect(response.position.row).toBe(7);
    expect(response.position.col).toBe(7);
    expect(response.score).toBe(100);
    expect(response.thinkingTime).toBe(500);
    expect(response.depth).toBe(4);
  });
});

describe("CpuBattleRecord", () => {
  it("対戦記録を構築できる", () => {
    const record: CpuBattleRecord = {
      id: "record-1",
      timestamp: Date.now(),
      difficulty: "medium",
      playerFirst: true,
      result: "win",
      moves: 42,
    };

    expect(record.id).toBe("record-1");
    expect(record.difficulty).toBe("medium");
    expect(record.playerFirst).toBe(true);
    expect(record.result).toBe("win");
    expect(record.moves).toBe(42);
  });

  it("resultは'win' | 'lose' | 'draw'のいずれか", () => {
    const results: CpuBattleRecord["result"][] = ["win", "lose", "draw"];
    for (const result of results) {
      const record: CpuBattleRecord = {
        id: "test",
        timestamp: Date.now(),
        difficulty: "beginner",
        playerFirst: true,
        result,
        moves: 10,
      };
      expect(record.result).toBe(result);
    }
  });
});

describe("CpuBattleStats", () => {
  it("統計情報を構築できる", () => {
    const stats: CpuBattleStats = {
      difficulty: "medium",
      wins: 10,
      losses: 5,
      draws: 2,
      totalGames: 17,
      winRate: 0.588,
    };

    expect(stats.difficulty).toBe("medium");
    expect(stats.wins).toBe(10);
    expect(stats.losses).toBe(5);
    expect(stats.draws).toBe(2);
    expect(stats.totalGames).toBe(17);
    expect(stats.winRate).toBeCloseTo(0.588, 2);
  });
});
