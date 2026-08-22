import { describe, expect, it } from "vitest";

import {
  type EngineParamsSnapshot,
  type MoveStatRecord,
  RECENT_MOVE_HISTORY_LIMIT,
  WorkerTelemetry,
  extractEngineParams,
  getWorkerTelemetry,
} from "./workerTelemetry.ts";

const engineParams: EngineParamsSnapshot = {
  worktreePath: "/tmp/A-abc1234",
  difficulty: "hard",
  depth: 12,
  timeLimit: 5000,
  maxNodes: 3000000,
  randomFactor: 0.02,
  evaluationOptions: { evalBasis: "prospect" },
  engine: "wasm",
  bookEnabled: false,
  hasStatsBuffer: true,
  threatProbe: "ON(default)",
};

const makeMove = (requestId: number): MoveStatRecord => ({
  requestId,
  gameIdx: 3,
  moveNumber: requestId,
  color: "white" as const,
  depth: 6,
  score: 120,
  thinkingTimeMs: 4900,
  roundTripMs: 4950,
  stats: { nodes: 123456 },
});

describe("WorkerTelemetry", () => {
  it("初期状態は要求 0・直近手なし・pending なし", () => {
    const t = new WorkerTelemetry();
    expect(t.snapshot()).toEqual({
      requestCount: 0,
      engineParams: undefined,
      pendingRequest: undefined,
      recentMoves: [],
    });
  });

  it("recordRequest で要求数が増え pending が入る", () => {
    const t = new WorkerTelemetry();
    t.recordRequest({
      requestId: 7,
      moveNumber: 4,
      color: "black",
      nonOpeningOrdinal: 1,
      moveSeed: 999,
      sentAt: "2026-08-23T00:00:00.000Z",
    });
    const snap = t.snapshot();
    expect(snap.requestCount).toBe(1);
    expect(snap.pendingRequest?.requestId).toBe(7);
    expect(snap.pendingRequest?.moveSeed).toBe(999);
  });

  it("応答が返ると pending がクリアされ直近手に積まれる", () => {
    const t = new WorkerTelemetry();
    t.recordRequest({
      requestId: 7,
      moveNumber: 4,
      color: "white",
      sentAt: "2026-08-23T00:00:00.000Z",
    });
    t.recordResponse(makeMove(7));
    const snap = t.snapshot();
    expect(snap.pendingRequest).toBeUndefined();
    expect(snap.recentMoves).toHaveLength(1);
    expect(snap.recentMoves[0]?.stats?.nodes).toBe(123456);
  });

  it("ハング時（応答なし）は pending が残る＝ハングした要求そのもの", () => {
    const t = new WorkerTelemetry();
    t.recordRequest({
      requestId: 1,
      moveNumber: 1,
      color: "black",
      sentAt: "2026-08-23T00:00:00.000Z",
    });
    t.recordResponse(makeMove(1));
    t.recordRequest({
      requestId: 2,
      moveNumber: 3,
      color: "black",
      sentAt: "2026-08-23T00:00:10.000Z",
    });
    const snap = t.snapshot();
    expect(snap.requestCount).toBe(2);
    expect(snap.pendingRequest?.requestId).toBe(2);
    expect(snap.recentMoves).toHaveLength(1);
  });

  it("直近手は historyLimit 件で古いものから捨てられる", () => {
    const t = new WorkerTelemetry(3);
    for (let i = 1; i <= 5; i++) {
      t.recordResponse(makeMove(i));
    }
    const ids = t.snapshot().recentMoves.map((m) => m.requestId);
    expect(ids).toEqual([3, 4, 5]);
  });

  it("既定の historyLimit は RECENT_MOVE_HISTORY_LIMIT", () => {
    const t = new WorkerTelemetry();
    for (let i = 1; i <= RECENT_MOVE_HISTORY_LIMIT + 4; i++) {
      t.recordResponse(makeMove(i));
    }
    expect(t.snapshot().recentMoves).toHaveLength(RECENT_MOVE_HISTORY_LIMIT);
  });

  it("snapshot は内部配列のコピーを返す（後続更新の影響を受けない）", () => {
    const t = new WorkerTelemetry();
    t.recordResponse(makeMove(1));
    const snap = t.snapshot();
    t.recordResponse(makeMove(2));
    expect(snap.recentMoves).toHaveLength(1);
  });

  it("setEngineParams はそのまま snapshot に載る", () => {
    const t = new WorkerTelemetry();
    t.setEngineParams(engineParams);
    expect(t.snapshot().engineParams).toEqual(engineParams);
  });
});

describe("getWorkerTelemetry", () => {
  it("同じ worker オブジェクトには同じ計測を返す", () => {
    const worker = {};
    expect(getWorkerTelemetry(worker)).toBe(getWorkerTelemetry(worker));
  });

  it("別の worker（再生成後）には空の計測を返す", () => {
    const oldWorker = {};
    getWorkerTelemetry(oldWorker).recordResponse(makeMove(1));
    const newWorker = {};
    expect(getWorkerTelemetry(newWorker).snapshot().recentMoves).toEqual([]);
  });
});

describe("extractEngineParams", () => {
  it("ready ペイロードから params を取り出す", () => {
    expect(extractEngineParams({ ready: true, params: engineParams })).toEqual(
      engineParams,
    );
  });

  it("params が無い古い bridge worker では undefined", () => {
    expect(extractEngineParams({ ready: true })).toBeUndefined();
  });

  it("params の必須フィールドが欠けていれば undefined", () => {
    expect(
      extractEngineParams({ ready: true, params: { difficulty: "hard" } }),
    ).toBeUndefined();
  });

  it("オブジェクト以外は undefined", () => {
    expect(extractEngineParams(null)).toBeUndefined();
    expect(extractEngineParams("ready")).toBeUndefined();
  });
});
