import { describe, expect, it } from "vitest";

import type { SPRTConfig } from "../types/ab.ts";

import { type MatchStatsGame, MatchStatsTracker } from "./matchStats.ts";

const SPRT: SPRTConfig = { elo0: 0, elo1: 30, alpha: 0.05, beta: 0.05 };

function game(
  pairId: string,
  isABlack: boolean,
  winner: "A" | "B" | "draw",
): MatchStatsGame {
  return {
    pairId,
    jushuName: pairId.split(":")[1] ?? pairId,
    isABlack,
    winner,
  };
}

describe("MatchStatsTracker", () => {
  it("push ごとに WDL と三項 Elo を更新する", () => {
    const t = new MatchStatsTracker(null);
    let s = t.push(game("0:直接", true, "A"));
    expect(s.wdl).toEqual({ wins: 1, draws: 0, losses: 0 });
    s = t.push(game("0:直接", false, "B"));
    expect(s.wdl).toEqual({ wins: 1, draws: 0, losses: 1 });
    s = t.push(game("0:間接", true, "draw"));
    expect(s.wdl).toEqual({ wins: 1, draws: 1, losses: 1 });
    expect(s.trinomialElo.winRate).toBe(0.5);
  });

  it("ペアは完成した時点で数え、未完成は unpaired", () => {
    const t = new MatchStatsTracker(null);
    let s = t.push(game("0:直接", true, "A"));
    expect(s.paired.pairs).toBe(0);
    expect(s.paired.unpaired).toBe(1);
    s = t.push(game("0:直接", false, "A"));
    expect(s.paired.pairs).toBe(1);
    expect(s.paired.unpaired).toBe(0);
    expect(s.paired.pentanomial.ww).toBe(1);
  });

  it("pairId が無ければ jushuName でペアリングする（旧規則）", () => {
    const t = new MatchStatsTracker(null);
    t.push({ jushuName: "直接", isABlack: true, winner: "A" });
    const s = t.push({ jushuName: "直接", isABlack: false, winner: "B" });
    expect(s.paired.pairs).toBe(1);
    expect(s.paired.pentanomial.dd).toBe(1);
  });

  it("SPRT 無効なら sprtDecision=continue で sprt は null", () => {
    const t = new MatchStatsTracker(null);
    const s = t.push(game("0:直接", true, "A"));
    expect(s.sprtDecision).toBe("continue");
    expect(s.paired.sprt).toBeNull();
    expect(s.sprtTrinomial).toBeNull();
  });

  it("停止判定はペア LLR: 三項が H1 でもペア 16 未満なら continue", () => {
    const t = new MatchStatsTracker(SPRT);
    // 三項では 40 連勝で H1 に達するが、完成ペアは 15 組しか無い
    let s = t.snapshot();
    for (let i = 0; i < 15; i++) {
      t.push(game(`${i}:x`, true, "A"));
      s = t.push(game(`${i}:x`, false, "A"));
    }
    for (let i = 15; i < 25; i++) {
      s = t.push(game(`${i}:x`, true, "A"));
    }
    expect(s.sprtTrinomial!.decision).toBe("H1");
    expect(s.paired.pairs).toBe(15);
    expect(s.sprtDecision).toBe("continue");
  });

  it("ペア LLR が上限を越えれば H1 で停止", () => {
    const t = new MatchStatsTracker(SPRT);
    let s = t.snapshot();
    for (let i = 0; i < 200; i++) {
      // ww と dd を交互に: 平均 0.75、σ² = 0.0625
      const w = i % 2 === 0 ? "A" : "B";
      t.push(game(`${i}:x`, true, "A"));
      s = t.push(game(`${i}:x`, false, w));
    }
    expect(s.sprtDecision).toBe("H1");
    expect(s.paired.sprt!.decision).toBe("H1");
  });

  it("snapshot は内部状態のコピーを返す", () => {
    const t = new MatchStatsTracker(null);
    const s = t.push(game("0:直接", true, "A"));
    s.wdl.wins = 99;
    expect(t.snapshot().wdl.wins).toBe(1);
  });
});
