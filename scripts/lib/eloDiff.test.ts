/**
 * eloDiff の Elo 変換（三項・ペアで共用）の固定テスト。
 */
import { describe, expect, it } from "vitest";

import {
  eloToScore,
  estimateEloDiff,
  scoreIntervalToElo,
  scoreToElo,
} from "./eloDiff.ts";

describe("scoreToElo / eloToScore", () => {
  it("互いに逆関数", () => {
    for (const elo of [-200, -30, 0, 30, 200]) {
      expect(scoreToElo(eloToScore(elo))).toBeCloseTo(elo, 6);
    }
  });

  it("score=0.5 は Elo 0、極端値はクランプされる", () => {
    expect(scoreToElo(0.5)).toBeCloseTo(0, 12);
    expect(scoreToElo(1)).toBeCloseTo(scoreToElo(0.999), 9);
    expect(scoreToElo(0)).toBeCloseTo(scoreToElo(0.001), 9);
  });
});

describe("scoreIntervalToElo", () => {
  it("平均 0.5・SE 0 なら Elo 0 で CI 幅 0", () => {
    const r = scoreIntervalToElo(0.5, 0);
    expect(r.eloDiff).toBeCloseTo(0, 12);
    expect(r.ci95Lower).toBeCloseTo(0, 12);
    expect(r.ci95Upper).toBeCloseTo(0, 12);
    expect(r.winRate).toBe(0.5);
  });

  it("SE が無限なら CI は ±Infinity", () => {
    const r = scoreIntervalToElo(0.6, Infinity);
    expect(r.ci95Lower).toBe(-Infinity);
    expect(r.ci95Upper).toBe(Infinity);
    expect(r.eloDiff).toBeCloseTo(70.4, 1);
  });

  it("estimateEloDiff と同じ数値を出す（既存出力の不変性）", () => {
    // 2026-08-23T12-32 の三項: +217 =6 -193 → +20.1 [-13.1, +53.6]
    const r = estimateEloDiff({ wins: 217, draws: 6, losses: 193 });
    expect(r.eloDiff).toBe(20.1);
    expect(r.ci95Lower).toBe(-13.1);
    expect(r.ci95Upper).toBe(53.6);
  });

  it("estimateEloDiff: 0 局なら CI ±Infinity", () => {
    expect(estimateEloDiff({ wins: 0, draws: 0, losses: 0 })).toEqual({
      eloDiff: 0,
      ci95Lower: -Infinity,
      ci95Upper: Infinity,
      winRate: 0.5,
    });
  });
});
