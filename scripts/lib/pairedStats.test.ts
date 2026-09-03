/**
 * ペア統計（pentanomial）の純粋関数テスト。
 * 手計算できる小ケースで Elo / 分散 / LLR / ガードを固定する。
 */
import { describe, expect, it } from "vitest";

import type { SPRTConfig } from "../types/ab.ts";

import { eloToScore, scoreToElo } from "./eloDiff.ts";
import {
  type PairScore,
  type PairableGame,
  buildPairs,
  computePairedStats,
  countPentanomial,
  estimatePairedElo,
  formatPairedStats,
  pairedLLR,
  toPairableGames,
  updatePairedSPRT,
} from "./pairedStats.ts";

const SPRT: SPRTConfig = { elo0: 0, elo1: 30, alpha: 0.05, beta: 0.05 };

type W = "A" | "B" | "draw";

/** pairId ごとに (A黒の勝者, A白の勝者) を並べた 2 局を作る。 */
function pairGames(id: string, black: W, white: W): PairableGame[] {
  return [
    { pairId: id, isABlack: true, winner: black },
    { pairId: id, isABlack: false, winner: white },
  ];
}

/** 指定したペア得点を持つ PairScore を n 個作る。 */
function scored(score: number, n: number): PairScore[] {
  return Array.from({ length: n }, (_, i) => ({
    pairId: `s${score}-${i}`,
    scoreABlack: score,
    scoreAWhite: score,
    score,
  }));
}

describe("toPairableGames", () => {
  it("pairId があればそれを使い、無ければ jushuName を pairId にする", () => {
    const out = toPairableGames([
      { pairId: "0:直接", jushuName: "直接", isABlack: true, winner: "A" },
      { jushuName: "間接", isABlack: false, winner: "B" },
    ]);
    expect(out).toEqual([
      { pairId: "0:直接", isABlack: true, winner: "A" },
      { pairId: "間接", isABlack: false, winner: "B" },
    ]);
  });
});

describe("buildPairs", () => {
  it("同一 pairId の A黒/A白 を出現順で zip し、得点は (黒+白)/2", () => {
    const games = [
      ...pairGames("p1", "A", "B"), // 1, 0 → 0.5
      ...pairGames("p2", "A", "A"), // 1, 1 → 1
      ...pairGames("p3", "draw", "B"), // 0.5, 0 → 0.25
    ];
    const { pairs, unpaired } = buildPairs(games);
    expect(unpaired).toBe(0);
    expect(pairs).toEqual([
      { pairId: "p1", scoreABlack: 1, scoreAWhite: 0, score: 0.5 },
      { pairId: "p2", scoreABlack: 1, scoreAWhite: 1, score: 1 },
      { pairId: "p3", scoreABlack: 0.5, scoreAWhite: 0, score: 0.25 },
    ]);
  });

  it("出現順が入れ替わっても pairId で結ぶ（並列実行）", () => {
    const games: PairableGame[] = [
      { pairId: "x", isABlack: false, winner: "B" },
      { pairId: "y", isABlack: true, winner: "A" },
      { pairId: "x", isABlack: true, winner: "A" },
      { pairId: "y", isABlack: false, winner: "A" },
    ];
    const { pairs, unpaired } = buildPairs(games);
    expect(unpaired).toBe(0);
    expect(pairs.map((p) => [p.pairId, p.score])).toEqual([
      ["x", 0.5],
      ["y", 1],
    ]);
  });

  it("旧 JSON 規則（pairId=珠型名）で同じ珠型が複数セットあっても順に zip する", () => {
    const games: PairableGame[] = [
      { pairId: "直接", isABlack: true, winner: "A" },
      { pairId: "直接", isABlack: false, winner: "A" },
      { pairId: "直接", isABlack: true, winner: "B" },
      { pairId: "直接", isABlack: false, winner: "B" },
    ];
    const { pairs, unpaired } = buildPairs(games);
    expect(unpaired).toBe(0);
    expect(pairs.map((p) => p.score)).toEqual([1, 0]);
  });

  it("相方が無い局は unpaired に数える", () => {
    const games: PairableGame[] = [
      ...pairGames("p1", "A", "B"),
      { pairId: "p2", isABlack: true, winner: "A" },
      { pairId: "p3", isABlack: false, winner: "A" },
      { pairId: "p3", isABlack: false, winner: "A" },
    ];
    const { pairs, unpaired } = buildPairs(games);
    expect(pairs).toHaveLength(1);
    expect(unpaired).toBe(3);
  });
});

describe("countPentanomial", () => {
  it("5 区分に振り分ける", () => {
    const pairs = [
      ...scored(0, 1),
      ...scored(0.25, 2),
      ...scored(0.5, 3),
      ...scored(0.75, 4),
      ...scored(1, 5),
    ];
    expect(countPentanomial(pairs)).toEqual({
      ll: 1,
      ld: 2,
      dd: 3,
      wd: 4,
      ww: 5,
    });
  });
});

describe("estimatePairedElo", () => {
  it("ペア 0 なら Elo 0・CI ±Infinity", () => {
    expect(estimatePairedElo([])).toEqual({
      eloDiff: 0,
      ci95Lower: -Infinity,
      ci95Upper: Infinity,
      winRate: 0.5,
    });
  });

  it("全ペア 1-1（σ²=0）なら Elo 0 でガード（CI ±Infinity）", () => {
    const r = estimatePairedElo(scored(0.5, 40));
    expect(r.eloDiff).toBeCloseTo(0, 12);
    expect(r.ci95Lower).toBe(-Infinity);
    expect(r.ci95Upper).toBe(Infinity);
    expect(r.winRate).toBe(0.5);
  });

  it("ww×20 は Elo 上限クランプ（score 0.999 相当）", () => {
    const r = estimatePairedElo(scored(1, 20));
    expect(r.eloDiff).toBe(Math.round(scoreToElo(0.999) * 10) / 10);
    expect(r.winRate).toBe(1);
    // σ²=0 なのでガード
    expect(r.ci95Upper).toBe(Infinity);
  });

  it("ペア数 < 16 なら CI ±Infinity（点推定は出す）", () => {
    const r = estimatePairedElo([...scored(1, 5), ...scored(0, 5)]);
    expect(r.eloDiff).toBeCloseTo(0, 12);
    expect(r.ci95Lower).toBe(-Infinity);
  });

  it("混合ケース（手計算）: ww8 wd4 dd6 ld2 → s̄=0.725, σ²=0.068125", () => {
    const pairs = [
      ...scored(1, 8),
      ...scored(0.75, 4),
      ...scored(0.5, 6),
      ...scored(0.25, 2),
    ];
    const mean = 0.725;
    const variance = 0.068125;
    const se = Math.sqrt(variance / 20);
    const r = estimatePairedElo(pairs);
    expect(r.winRate).toBe(0.725);
    expect(r.eloDiff).toBe(Math.round(scoreToElo(mean) * 10) / 10);
    expect(r.ci95Lower).toBe(
      Math.round(scoreToElo(mean - 1.96 * se) * 10) / 10,
    );
    expect(r.ci95Upper).toBe(
      Math.round(scoreToElo(mean + 1.96 * se) * 10) / 10,
    );
    // 数値も固定（回帰検知用）
    expect(r.eloDiff).toBe(168.4);
    expect(r.ci95Lower).toBe(78.2);
    expect(r.ci95Upper).toBe(287.3);
  });
});

describe("pairedLLR / updatePairedSPRT", () => {
  it("ガード: ペア数 < 16 は LLR 0・continue", () => {
    const pairs = [...scored(1, 10), ...scored(0.75, 5)];
    expect(pairedLLR(pairs, SPRT)).toBe(0);
    expect(updatePairedSPRT(pairs, SPRT).decision).toBe("continue");
  });

  it("ガード: σ² < 1e-4 は LLR 0・continue", () => {
    expect(pairedLLR(scored(1, 100), SPRT)).toBe(0);
    expect(updatePairedSPRT(scored(0.5, 100), SPRT).decision).toBe("continue");
  });

  it("正規近似 N·(s1−s0)·(2s̄−s0−s1)/(2σ²) と一致", () => {
    const pairs = [
      ...scored(1, 8),
      ...scored(0.75, 4),
      ...scored(0.5, 6),
      ...scored(0.25, 2),
    ];
    const s0 = eloToScore(0);
    const s1 = eloToScore(30);
    const expected = (20 * (s1 - s0) * (2 * 0.725 - s0 - s1)) / (2 * 0.068125);
    expect(pairedLLR(pairs, SPRT)).toBeCloseTo(expected, 10);
    expect(expected).toBeGreaterThan(0);
  });

  it("強い証拠で H1 / H0 に到達する", () => {
    const strong = [...scored(1, 150), ...scored(0.75, 30), ...scored(0.5, 20)];
    const h1 = updatePairedSPRT(strong, SPRT);
    expect(h1.decision).toBe("H1");
    expect(h1.llr).toBeGreaterThanOrEqual(h1.upperBound);

    const weak = [...scored(0, 150), ...scored(0.25, 30), ...scored(0.5, 20)];
    const h0 = updatePairedSPRT(weak, SPRT);
    expect(h0.decision).toBe("H0");
    expect(h0.llr).toBeLessThanOrEqual(h0.lowerBound);
  });

  it("境界は三項 SPRT と同じ（alpha/beta から）", () => {
    const st = updatePairedSPRT(scored(0.5, 20), SPRT);
    expect(st.lowerBound).toBeCloseTo(Math.log(0.05 / 0.95), 10);
    expect(st.upperBound).toBeCloseTo(Math.log(0.95 / 0.05), 10);
  });
});

describe("computePairedStats / formatPairedStats", () => {
  it("games から PairedStats を組み立てる（SPRT 無しなら sprt=null）", () => {
    const games = [
      ...pairGames("p1", "A", "A"),
      ...pairGames("p2", "A", "B"),
      { pairId: "p3", isABlack: true, winner: "A" as const },
    ];
    const st = computePairedStats(games, null);
    expect(st.pairs).toBe(2);
    expect(st.unpaired).toBe(1);
    expect(st.pentanomial).toEqual({ ll: 0, ld: 0, dd: 1, wd: 0, ww: 1 });
    expect(st.elo.winRate).toBe(0.75);
    expect(st.sprt).toBeNull();
  });

  it("SPRT 設定があればペア判定を入れる", () => {
    const games = pairGames("p1", "A", "A");
    const st = computePairedStats(games, SPRT);
    expect(st.sprt).not.toBeNull();
    expect(st.sprt!.decision).toBe("continue");
  });

  it("formatPairedStats は Elo・CI・pentanomial・未ペア数を含む", () => {
    const st = computePairedStats(
      [...pairGames("p1", "A", "A"), ...pairGames("p2", "A", "B")],
      null,
    );
    const s = formatPairedStats(st);
    expect(s).toContain("ペア");
    expect(s).toContain("ww=1");
    expect(s).toContain("dd=1");
    expect(s).toContain("Elo");
  });
});
