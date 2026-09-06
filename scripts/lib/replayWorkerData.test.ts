import { describe, expect, it } from "vitest";

import type { EngineParamsSnapshot } from "./workerTelemetry.ts";

import { buildReplayWorkerData } from "./replayWorkerData.ts";

const dumpWorker = {
  worktreePath: "/tmp/A-abc1234",
  difficulty: "hard",
  randomFactor: undefined as number | undefined,
  evaluationOptions: undefined as Record<string, unknown> | undefined,
  bookEnabled: false,
};

const engineParams: EngineParamsSnapshot = {
  worktreePath: "/tmp/A-abc1234",
  difficulty: "hard",
  depth: 7,
  timeLimit: 0,
  maxNodes: 50000,
  randomFactor: 0,
  evaluationOptions: { evalBasis: "prospect" },
  engine: "wasm",
  bookEnabled: false,
  hasStatsBuffer: true,
  threatProbe: "ON(default)",
  deterministic: true,
  searchFeatures: 3,
};

describe("buildReplayWorkerData", () => {
  it("engineParams から timeLimit / deterministic / maxNodes / depth を復元する（固定ノード局を 10 s 時間モードで再生しない）", () => {
    const data = buildReplayWorkerData(dumpWorker, engineParams);
    expect(data.customParams).toEqual({
      randomFactor: 0,
      evaluationOptions: { evalBasis: "prospect" },
      maxNodes: 50000,
      depth: 7,
      timeLimit: 0,
      deterministic: true,
    });
    expect(data.difficulty).toBe("hard");
    expect(data.bookEnabled).toBe(false);
    expect(data.threatProbeEnabled).toBeUndefined();
  });

  it("時間モードの engineParams はそのまま復元（deterministic は写らない）", () => {
    const data = buildReplayWorkerData(dumpWorker, {
      ...engineParams,
      timeLimit: 10000,
      maxNodes: 1000000,
      deterministic: undefined,
    });
    expect(data.customParams).toEqual({
      randomFactor: 0,
      evaluationOptions: { evalBasis: "prospect" },
      maxNodes: 1000000,
      depth: 7,
      timeLimit: 10000,
    });
  });

  it("旧 bridge worker の engineParams（deterministic 欠落）は時間モードとして扱う", () => {
    const { deterministic: _d, searchFeatures: _f, ...legacy } = engineParams;
    const data = buildReplayWorkerData(dumpWorker, legacy);
    expect(data.customParams).not.toHaveProperty("deterministic");
  });

  it("engineParams 欠落（v1 ダンプ）はトップレベル情報でフォールバック", () => {
    const data = buildReplayWorkerData(
      {
        ...dumpWorker,
        randomFactor: 0.02,
        evaluationOptions: { evalBasis: "legacy" },
        bookEnabled: true,
      },
      undefined,
    );
    expect(data.customParams).toEqual({
      randomFactor: 0.02,
      evaluationOptions: { evalBasis: "legacy" },
    });
    expect(data.bookEnabled).toBe(true);
  });

  it("threatProbe が OFF で走っていたときだけ明示無効化", () => {
    const data = buildReplayWorkerData(dumpWorker, {
      ...engineParams,
      threatProbe: "OFF(runtime)",
    });
    expect(data.threatProbeEnabled).toBe(false);
  });

  it("livenessChannel を毎回新規に持つ", () => {
    const data = buildReplayWorkerData(dumpWorker, engineParams);
    expect(data.livenessChannel.buffer).toBeInstanceOf(SharedArrayBuffer);
  });
});
