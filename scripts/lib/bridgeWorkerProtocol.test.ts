import { describe, expect, it } from "vitest";

import type { EngineParamsSnapshot } from "./workerTelemetry.ts";

import {
  diffEngineParams,
  fingerprintEvalWeights,
  isReadyMessage,
  parseEngineParams,
} from "./bridgeWorkerProtocol.ts";

const params: EngineParamsSnapshot = {
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

describe("isReadyMessage", () => {
  it("ready:true なら true", () => {
    expect(isReadyMessage({ ready: true })).toBe(true);
  });
  it("着手応答は false", () => {
    expect(isReadyMessage({ requestId: 1 })).toBe(false);
  });
  it("非オブジェクトは false", () => {
    expect(isReadyMessage(null)).toBe(false);
    expect(isReadyMessage("ready")).toBe(false);
  });
});

describe("parseEngineParams", () => {
  it("ready ペイロードから params を取り出す", () => {
    expect(parseEngineParams({ ready: true, params })).toEqual(params);
  });

  it("params が無い古い bridge worker では undefined", () => {
    expect(parseEngineParams({ ready: true })).toBeUndefined();
  });

  it("必須フィールドが欠けていれば undefined（部分的に壊れた params を通さない）", () => {
    const { depth: _depth, ...withoutDepth } = params;
    expect(
      parseEngineParams({ ready: true, params: withoutDepth }),
    ).toBeUndefined();
  });

  it("型が違うフィールドがあれば undefined", () => {
    expect(
      parseEngineParams({ ready: true, params: { ...params, maxNodes: "1M" } }),
    ).toBeUndefined();
  });

  it("engine が想定外の値なら undefined", () => {
    expect(
      parseEngineParams({ ready: true, params: { ...params, engine: "gpu" } }),
    ).toBeUndefined();
  });

  it("NaN は有効な数値として扱わない", () => {
    expect(
      parseEngineParams({ ready: true, params: { ...params, timeLimit: NaN } }),
    ).toBeUndefined();
  });

  it("オブジェクト以外は undefined", () => {
    expect(parseEngineParams(null)).toBeUndefined();
    expect(parseEngineParams("ready")).toBeUndefined();
  });
});

describe("diffEngineParams", () => {
  it("同一なら差分なし", () => {
    expect(diffEngineParams(params, { ...params })).toEqual([]);
  });

  it("探索に効く値の差を検出する", () => {
    const diffs = diffEngineParams(params, { ...params, maxNodes: 3000000 });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.key).toBe("maxNodes");
  });

  it("evaluationOptions の差も検出する", () => {
    const diffs = diffEngineParams(params, {
      ...params,
      evaluationOptions: { evalBasis: "legacy" },
    });
    expect(diffs.map((d) => d.key)).toContain("evaluationOptions");
  });

  it("eval 重みの指紋差も検出する", () => {
    const diffs = diffEngineParams(params, {
      ...params,
      evalWeightsFingerprint: { count: 2, hash: "abc" },
    });
    expect(diffs.map((d) => d.key)).toContain("evalWeightsFingerprint");
  });

  it("どちらかが未取得なら比較しない（誤検知を避ける）", () => {
    expect(diffEngineParams(undefined, params)).toEqual([]);
    expect(diffEngineParams(params, undefined)).toEqual([]);
  });
});

describe("fingerprintEvalWeights", () => {
  it("未指定なら undefined", () => {
    expect(fingerprintEvalWeights(undefined)).toBeUndefined();
  });

  it("空なら count 0", () => {
    expect(fingerprintEvalWeights({})).toEqual({ count: 0, hash: "0" });
  });

  it("キー順が違っても同じ指紋", () => {
    const a = fingerprintEvalWeights({ x: 1, y: 2 });
    const b = fingerprintEvalWeights({ y: 2, x: 1 });
    expect(a).toEqual(b);
  });

  it("値が違えば指紋も違う", () => {
    const a = fingerprintEvalWeights({ x: 1 });
    const b = fingerprintEvalWeights({ x: 2 });
    expect(a?.hash).not.toBe(b?.hash);
  });
});
