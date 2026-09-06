import { describe, expect, it } from "vitest";

import {
  type HangLiveness,
  createLivenessChannel,
  createTimestampProbe,
  describeLivenessVerdict,
  diagnoseLiveness,
  markLivenessRequest,
  readLiveness,
} from "./workerLiveness.ts";

describe("describeLivenessVerdict", () => {
  const stalled: HangLiveness = {
    timeCheckCount: 12,
    requestId: 1,
    timeCheckDeltaDuringSample: 0,
    sampleWindowMs: 250,
    verdict: "stalled",
  };
  it("時間モードでは verdict と回数だけ", () => {
    const text = describeLivenessVerdict(stalled, undefined);
    expect(text).toMatch(/stalled/);
    expect(text).not.toMatch(/deterministic/);
  });
  it("決定的モードでは『時間チェック回数は生存指標にならない』注記を付ける", () => {
    const text = describeLivenessVerdict(stalled, true);
    expect(text).toMatch(/deterministic/);
    expect(text).toMatch(/生存指標にならない/);
  });
});

describe("createTimestampProbe", () => {
  it("チャネル無しでも動き、performance.now() の ms を返す", () => {
    const probe = createTimestampProbe(undefined, () => 1234.6);
    expect(probe()).toBe(1235);
  });

  it("呼ばれるたびに時間チェック回数が増える", () => {
    const channel = createLivenessChannel();
    const probe = createTimestampProbe(channel, () => 10);
    probe();
    probe();
    probe();
    expect(readLiveness(channel).timeCheckCount).toBe(3);
  });

  it("戻り値は元の実装と同じ（探索挙動を変えない）", () => {
    const channel = createLivenessChannel();
    const probe = createTimestampProbe(channel, () => 42.4);
    expect(probe()).toBe(42);
  });

  it("直近の時間チェック時刻が記録される", () => {
    const channel = createLivenessChannel();
    createTimestampProbe(channel, () => 0)();
    const { lastCheckMs } = readLiveness(channel);
    expect(lastCheckMs).toBeGreaterThanOrEqual(0);
    expect(lastCheckMs).toBeLessThan(60000);
  });
});

describe("markLivenessRequest", () => {
  it("処理中の requestId を刻む", () => {
    const channel = createLivenessChannel();
    markLivenessRequest(channel, 265);
    expect(readLiveness(channel).requestId).toBe(265);
  });

  it("チャネル無しでも例外にならない", () => {
    expect(() => markLivenessRequest(undefined, 1)).not.toThrow();
  });
});

describe("diagnoseLiveness", () => {
  it("チャネルが無ければ unavailable", async () => {
    const result = await diagnoseLiveness(undefined);
    expect(result.verdict).toBe("unavailable");
  });

  it("一度も時間チェックが無ければ never-started", async () => {
    const channel = createLivenessChannel();
    const result = await diagnoseLiveness(channel, 5);
    expect(result.verdict).toBe("never-started");
    expect(result.timeCheckCount).toBe(0);
  });

  it("サンプル中に進んでいなければ stalled", async () => {
    const channel = createLivenessChannel();
    createTimestampProbe(channel, () => 0)();
    const result = await diagnoseLiveness(channel, 5);
    expect(result.verdict).toBe("stalled");
    expect(result.timeCheckDeltaDuringSample).toBe(0);
    expect(result.lastTimeCheckAt).toBeTypeOf("string");
  });

  it("サンプル中も進んでいれば searching（探索が走り続けている）", async () => {
    const channel = createLivenessChannel();
    const probe = createTimestampProbe(channel, () => 0);
    probe();
    const timer = setInterval(probe, 1);
    const result = await diagnoseLiveness(channel, 30);
    clearInterval(timer);
    expect(result.verdict).toBe("searching");
    expect(result.timeCheckDeltaDuringSample).toBeGreaterThan(0);
  });

  it("処理中の requestId も返す", async () => {
    const channel = createLivenessChannel();
    createTimestampProbe(channel, () => 0)();
    markLivenessRequest(channel, 77);
    const result = await diagnoseLiveness(channel, 5);
    expect(result.requestId).toBe(77);
  });
});
