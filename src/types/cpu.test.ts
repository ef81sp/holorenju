/**
 * CPU対戦関連の型定義テスト
 */

import { describe, expect, it } from "vitest";

import {
  CPU_DIFFICULTIES,
  DIFFICULTY_PARAMS,
  isCpuDifficulty,
  type AIRequest,
  type AIResponse,
  type CpuBattleRecord,
  type CpuBattleStats,
  type CpuDifficulty,
  type DifficultyParams,
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

  it("maxNodesが難易度順に増加する", () => {
    expect(DIFFICULTY_PARAMS.beginner.maxNodes).toBe(10000);
    expect(DIFFICULTY_PARAMS.easy.maxNodes).toBe(50000);
    expect(DIFFICULTY_PARAMS.medium.maxNodes).toBe(200000);
    expect(DIFFICULTY_PARAMS.hard.maxNodes).toBe(500000);
  });

  it("beginnerは探索深度1、ランダム要素0.3", () => {
    const params: DifficultyParams = DIFFICULTY_PARAMS.beginner;
    expect(params.depth).toBe(1);
    expect(params.timeLimit).toBe(1000);
    expect(params.randomFactor).toBe(0.3);
  });

  it("easyは探索深度2、ランダム要素0.25", () => {
    const params: DifficultyParams = DIFFICULTY_PARAMS.easy;
    expect(params.depth).toBe(2);
    expect(params.timeLimit).toBe(2000);
    expect(params.randomFactor).toBe(0.25);
  });

  it("mediumは探索深度3、ランダム要素0", () => {
    const params: DifficultyParams = DIFFICULTY_PARAMS.medium;
    expect(params.depth).toBe(3);
    expect(params.timeLimit).toBe(3000);
    expect(params.randomFactor).toBe(0);
  });

  it("hardは探索深度4、ランダム要素0", () => {
    const params: DifficultyParams = DIFFICULTY_PARAMS.hard;
    expect(params.depth).toBe(4);
    expect(params.timeLimit).toBe(5000);
    expect(params.randomFactor).toBe(0);
  });
});

describe("AIRequest/AIResponse型", () => {
  it("AIRequestを構築できる", () => {
    const request: AIRequest = {
      board: new Array(15).fill(null).map(() => new Array(15).fill(null)),
      currentTurn: "black",
      difficulty: "medium",
    };

    expect(request.board).toHaveLength(15);
    expect(request.currentTurn).toBe("black");
    expect(request.difficulty).toBe("medium");
  });

  it("AIResponseを構築できる", () => {
    const response: AIResponse = {
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
