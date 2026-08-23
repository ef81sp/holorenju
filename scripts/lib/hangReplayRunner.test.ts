import { describe, expect, it } from "vitest";

import type { ReplayMove } from "./hangReplay.ts";

import {
  type ReplayRequestOutcome,
  type ReplayStage,
  countPlannedRequests,
  runReplayStages,
} from "./hangReplayRunner.ts";

function makeMoves(nonOpeningCount: number): ReplayMove[] {
  const moves: ReplayMove[] = [
    { row: 7, col: 7, isOpening: true },
    { row: 6, col: 8, isOpening: true },
    { row: 9, col: 7, isOpening: true },
  ];
  for (let i = 0; i < nonOpeningCount; i++) {
    moves.push({ row: i, col: 14 - i, isOpening: false });
  }
  return moves;
}

const stage = (
  label: string,
  isABlack: boolean,
  count: number,
): ReplayStage => ({
  label,
  moves: makeMoves(count),
  isABlack,
  gameSeed: 555,
});

const responded: ReplayRequestOutcome = { status: "responded", elapsedMs: 10 };

describe("countPlannedRequests", () => {
  it("ステージ横断で要求数を数える", () => {
    const stages = [stage("g1", true, 4), stage("g2", false, 4)];
    expect(countPlannedRequests(stages, "A")).toBe(4);
  });

  it("side が変われば数も変わりうる", () => {
    // 非オープニング手は index 3(白) 4(黒) 5(白)。A黒なら 1 手、B（白）なら 2 手。
    const stages = [stage("g1", true, 3)];
    expect(countPlannedRequests(stages, "A")).toBe(1);
    expect(countPlannedRequests(stages, "B")).toBe(2);
  });
});

describe("runReplayStages", () => {
  it("ハング側の手番だけを、盤面を進めながら順に要求する", async () => {
    const seen: { color: string; stones: number }[] = [];
    const result = await runReplayStages({
      stages: [stage("g1", true, 4)],
      side: "A",
      request: ({ board, color }) => {
        const stones = board.flat().filter((cell) => cell !== null).length;
        seen.push({ color, stones });
        return Promise.resolve(responded);
      },
    });
    expect(result.requestedMoves).toBe(2);
    expect(result.failure).toBeUndefined();
    // 黒番の要求は「3(開局)+1」個と「3+3」個の石が置かれた局面
    expect(seen).toEqual([
      { color: "black", stones: 4 },
      { color: "black", stones: 6 },
    ]);
  });

  it("moveSeed は計画どおり渡される", async () => {
    const seeds: (number | undefined)[] = [];
    await runReplayStages({
      stages: [stage("g1", false, 4)],
      side: "A",
      request: ({ moveSeed }) => {
        seeds.push(moveSeed);
        return Promise.resolve(responded);
      },
    });
    expect(seeds).toHaveLength(2);
    expect(seeds[0]).toBeTypeOf("number");
    expect(seeds[0]).not.toBe(seeds[1]);
  });

  it("timed-out が返ったらその場で止めて failure を返す", async () => {
    let calls = 0;
    const result = await runReplayStages({
      stages: [stage("g1", true, 6)],
      side: "A",
      request: () => {
        calls++;
        return Promise.resolve(
          calls === 2
            ? { status: "timed-out" as const, elapsedMs: 30000 }
            : responded,
        );
      },
    });
    expect(result.requestedMoves).toBe(2);
    expect(result.failure?.status).toBe("timed-out");
    expect(result.failure?.stageLabel).toBe("g1");
  });

  it("error は timed-out と区別して返す", async () => {
    const result = await runReplayStages({
      stages: [stage("g1", true, 2)],
      side: "A",
      request: () =>
        Promise.resolve({
          status: "error" as const,
          elapsedMs: 5,
          errorMessage: "boom",
        }),
    });
    expect(result.failure?.status).toBe("error");
    expect(result.failure?.errorMessage).toBe("boom");
  });

  it("複数ステージを順に再生し、局ごとに盤面をリセットする", async () => {
    const stoneCounts: number[] = [];
    const result = await runReplayStages({
      stages: [stage("g1", true, 2), stage("g2", true, 2)],
      side: "A",
      request: ({ board }) => {
        stoneCounts.push(board.flat().filter((c) => c !== null).length);
        return Promise.resolve(responded);
      },
    });
    expect(result.requestedMoves).toBe(2);
    // 2局目も 4 石から始まる（前局の石を持ち越さない）
    expect(stoneCounts).toEqual([4, 4]);
  });

  it("進捗フックが呼ばれる", async () => {
    const stageStarts: number[] = [];
    let doneCalls = 0;
    await runReplayStages({
      stages: [stage("g1", true, 4)],
      side: "A",
      request: () => Promise.resolve(responded),
      onStageStart: (_s, planned) => stageStarts.push(planned),
      onRequestDone: () => {
        doneCalls++;
      },
    });
    expect(stageStarts).toEqual([2]);
    expect(doneCalls).toBe(2);
  });
});
