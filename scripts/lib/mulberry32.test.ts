import { describe, expect, it } from "vitest";

import { mixSeed, mulberry32 } from "./mulberry32.ts";

describe("mulberry32", () => {
  it("同一 seed からは同一シーケンスを返す（決定性）", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("異なる seed からは異なるシーケンスを返す（衝突しない）", () => {
    const a = mulberry32(42);
    const b = mulberry32(43);
    const va = a();
    const vb = b();
    expect(va).not.toBe(vb);
  });

  it("値は [0, 1) の範囲に収まる", () => {
    const r = mulberry32(12345);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("seed=0 でも動作する（内部加算があるため縮退しない）", () => {
    const r = mulberry32(0);
    const v1 = r();
    const v2 = r();
    expect(v1).not.toBe(v2);
    expect(v1).toBeGreaterThanOrEqual(0);
    expect(v1).toBeLessThan(1);
  });
});

describe("mixSeed", () => {
  it("同じ入力なら同じ出力（決定性）", () => {
    expect(mixSeed(42, 0)).toBe(mixSeed(42, 0));
    expect(mixSeed(42, 0, 3)).toBe(mixSeed(42, 0, 3));
  });

  it("引数の順序で結果が変わる（順序依存）", () => {
    expect(mixSeed(1, 2)).not.toBe(mixSeed(2, 1));
  });

  it("gameIdx 違いで大量に衝突しない（実運用範囲を粗くチェック）", () => {
    const baseSeed = 12345;
    const seen = new Set<number>();
    for (let g = 0; g < 200; g++) {
      seen.add(mixSeed(baseSeed, g));
    }
    // 200 種類の gameIdx で 200 種類近い seed が出ることを要求（衝突 1〜2 は許容）
    expect(seen.size).toBeGreaterThanOrEqual(198);
  });

  it("moveOrdinal 違いでも大量に衝突しない（1局あたり最大 ~200 手を想定）", () => {
    const perGameSeed = mixSeed(12345, 7);
    const seen = new Set<number>();
    for (let m = 0; m < 200; m++) {
      seen.add(mixSeed(perGameSeed, m));
    }
    expect(seen.size).toBeGreaterThanOrEqual(198);
  });
});
