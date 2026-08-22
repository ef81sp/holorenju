import { describe, expect, it } from "vitest";

import {
  type EngineParamsSnapshot,
  type MoveStatRecord,
  type RecentGameRecord,
  RECENT_GAMES_HISTORY_LIMIT,
  RECENT_MOVE_HISTORY_LIMIT,
  WorkerTelemetry,
  getWorkerTelemetry,
} from "./workerTelemetry.ts";

const engineParams: EngineParamsSnapshot = {
  worktreePath: "/tmp/A-abc1234",
  difficulty: "hard",
  depth: 12,
  timeLimit: 10000,
  maxNodes: 1000000,
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
  color: "white",
  depth: 6,
  score: 120,
  interrupted: true,
  thinkingTimeMs: 29600,
  roundTripMs: 29650,
  stats: { nodes: 123456 },
});

const makeGame = (gameIdx: number): RecentGameRecord => ({
  gameIdx,
  jushuName: "寒星",
  isABlack: true,
  gameSeed: 111,
  moves: [{ row: 7, col: 7, isOpening: true }],
});

describe("WorkerTelemetry", () => {
  it("初期状態は要求 0・直近手/直近局なし・pending なし", () => {
    const t = new WorkerTelemetry();
    expect(t.snapshot()).toEqual({
      requestCount: 0,
      engineParams: undefined,
      pendingRequest: undefined,
      recentMoves: [],
      recentGames: [],
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

  it("interrupted を保持する（長考が打ち切られたか走り切ったかの判別）", () => {
    const t = new WorkerTelemetry();
    t.recordResponse({ ...makeMove(1), interrupted: false });
    t.recordResponse({ ...makeMove(2), interrupted: true });
    expect(t.snapshot().recentMoves.map((m) => m.interrupted)).toEqual([
      false,
      true,
    ]);
  });

  it("エラー応答で clearPending すると pending が消える", () => {
    const t = new WorkerTelemetry();
    t.recordRequest({
      requestId: 9,
      moveNumber: 2,
      color: "black",
      sentAt: "2026-08-23T00:00:00.000Z",
    });
    t.clearPending(9);
    expect(t.snapshot().pendingRequest).toBeUndefined();
  });

  it("別 requestId の clearPending では消えない", () => {
    const t = new WorkerTelemetry();
    t.recordRequest({
      requestId: 9,
      moveNumber: 2,
      color: "black",
      sentAt: "2026-08-23T00:00:00.000Z",
    });
    t.clearPending(8);
    expect(t.snapshot().pendingRequest?.requestId).toBe(9);
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
    expect(t.snapshot().recentMoves.map((m) => m.requestId)).toEqual([3, 4, 5]);
  });

  it("既定の historyLimit は RECENT_MOVE_HISTORY_LIMIT（32）", () => {
    expect(RECENT_MOVE_HISTORY_LIMIT).toBe(32);
    const t = new WorkerTelemetry();
    for (let i = 1; i <= RECENT_MOVE_HISTORY_LIMIT + 4; i++) {
      t.recordResponse(makeMove(i));
    }
    expect(t.snapshot().recentMoves).toHaveLength(RECENT_MOVE_HISTORY_LIMIT);
  });

  it("直近局も上限で切られる", () => {
    const t = new WorkerTelemetry(8, 2);
    t.recordGame(makeGame(1));
    t.recordGame(makeGame(2));
    t.recordGame(makeGame(3));
    expect(t.snapshot().recentGames.map((g) => g.gameIdx)).toEqual([2, 3]);
  });

  it("既定の直近局上限は RECENT_GAMES_HISTORY_LIMIT（10）", () => {
    expect(RECENT_GAMES_HISTORY_LIMIT).toBe(10);
    const t = new WorkerTelemetry();
    for (let i = 0; i < RECENT_GAMES_HISTORY_LIMIT + 3; i++) {
      t.recordGame(makeGame(i));
    }
    expect(t.snapshot().recentGames).toHaveLength(RECENT_GAMES_HISTORY_LIMIT);
  });

  it("clearGames で直近局を捨てられる", () => {
    const t = new WorkerTelemetry();
    t.recordGame(makeGame(1));
    t.clearGames();
    expect(t.snapshot().recentGames).toEqual([]);
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

  it("生存信号チャネルを保持する", () => {
    const t = new WorkerTelemetry();
    expect(t.getLivenessChannel()).toBeUndefined();
    const channel = { buffer: new SharedArrayBuffer(16), epochBase: 1 };
    t.setLivenessChannel(channel);
    expect(t.getLivenessChannel()).toBe(channel);
  });
});

describe("getWorkerTelemetry", () => {
  it("同じ worker オブジェクトには同じ計測を返す", () => {
    const worker = {};
    expect(getWorkerTelemetry(worker)).toBe(getWorkerTelemetry(worker));
  });

  it("別の worker（再生成後）には空の計測を返す", () => {
    const oldWorker = {};
    getWorkerTelemetry(oldWorker).recordGame(makeGame(1));
    const newWorker = {};
    expect(getWorkerTelemetry(newWorker).snapshot().recentGames).toEqual([]);
  });
});
