/**
 * benchGameStats（distinct 棋譜数 / 色別勝率 / 開局別勝敗）のテスト。
 */
import { describe, expect, it } from "vitest";

import type { CommitGameResult } from "../types/commit-bench.ts";

import {
  computeBenchGameStats,
  countColorResults,
  countDistinctKifu,
  countOpeningResults,
  formatBenchGameStats,
} from "./benchGameStats.ts";

/** 手順（"r,c" の列）から最小限の CommitGameResult を作る。 */
function game(
  moves: string,
  opts: {
    winner?: "A" | "B" | "draw";
    isABlack?: boolean;
    jushuName?: string;
  } = {},
): CommitGameResult {
  const moveHistory = moves.split(" ").map((m, i) => {
    const [r, c] = m.split(",").map(Number);
    return { row: r!, col: c!, time: 0, isOpening: i < 3 };
  });
  return {
    playerA: "A",
    playerB: "B",
    winner: opts.winner ?? "A",
    reason: "five",
    moves: moveHistory.length,
    duration: 0,
    moveHistory,
    isABlack: opts.isABlack ?? true,
    jushuName: opts.jushuName ?? "直接",
  };
}

// 開局 3 手 + 続き。先頭 n 手で比較するので長さ 20 の手順を用意する。
const base = Array.from({ length: 20 }, (_, i) => `${i},${i}`).join(" ");
const divergeAt = (ply: number): string =>
  Array.from({ length: 20 }, (_, i) =>
    i < ply ? `${i},${i}` : `${i},${14 - i}`,
  ).join(" ");

describe("countDistinctKifu", () => {
  it("同一棋譜は 1 と数える", () => {
    const r = countDistinctKifu([game(base), game(base), game(base)]);
    expect(r).toEqual({ byPly: { 8: 1, 12: 1, 16: 1 }, full: 1 });
  });

  it("分岐位置に応じて ply 別の distinct が変わる", () => {
    const games = [game(base), game(divergeAt(10)), game(divergeAt(14))];
    // @8: 全部同じ / @12: base と 10分岐が違う（14分岐は base と同じ）/ @16: 3 通り
    expect(countDistinctKifu(games)).toEqual({
      byPly: { 8: 1, 12: 2, 16: 3 },
      full: 3,
    });
  });

  it("短い棋譜（n 手未満）はそのまま比較される", () => {
    const games = [game("0,0 1,1 2,2 3,3"), game("0,0 1,1 2,2 3,3 4,4")];
    expect(countDistinctKifu(games).byPly[8]).toBe(2);
  });

  it("plies を指定できる", () => {
    expect(countDistinctKifu([game(base)], [4]).byPly).toEqual({ 4: 1 });
  });
});

describe("countColorResults", () => {
  it("黒勝/白勝/引分を A/B に関係なく数える", () => {
    const games = [
      game(base, { winner: "A", isABlack: true }), // 黒勝
      game(base, { winner: "B", isABlack: true }), // 白勝
      game(base, { winner: "A", isABlack: false }), // 白勝
      game(base, { winner: "draw", isABlack: false }),
    ];
    expect(countColorResults(games)).toEqual({
      blackWins: 1,
      whiteWins: 2,
      draws: 1,
      blackWinRate: 0.25,
    });
  });

  it("0 局なら blackWinRate は 0", () => {
    expect(countColorResults([]).blackWinRate).toBe(0);
  });
});

describe("countOpeningResults", () => {
  it("開局ラベル別に A視点 WDL と黒勝数を集計する（出現順）", () => {
    const games = [
      game(base, { jushuName: "間接", winner: "A", isABlack: true }),
      game(base, { jushuName: "直接", winner: "B", isABlack: true }),
      game(base, { jushuName: "間接", winner: "A", isABlack: false }),
      game(base, { jushuName: "間接", winner: "draw", isABlack: true }),
    ];
    expect(countOpeningResults(games)).toEqual([
      {
        openingId: "間接",
        games: 3,
        wdl: { wins: 2, draws: 1, losses: 0 },
        blackWins: 1,
        whiteWins: 1,
        draws: 1,
      },
      {
        openingId: "直接",
        games: 1,
        wdl: { wins: 0, draws: 0, losses: 1 },
        blackWins: 0,
        whiteWins: 1,
        draws: 0,
      },
    ]);
  });
});

describe("computeBenchGameStats / formatBenchGameStats", () => {
  it("全部まとめて返し、文字列に distinct と黒勝率が出る", () => {
    const games = [game(base), game(divergeAt(10), { winner: "B" })];
    const st = computeBenchGameStats(games);
    expect(st.totalGames).toBe(2);
    expect(st.distinct.full).toBe(2);
    expect(st.color.blackWins).toBe(1);
    expect(st.openings).toHaveLength(1);
    const s = formatBenchGameStats(st);
    expect(s).toContain("distinct");
    expect(s).toContain("@8=1");
    expect(s).toContain("完全=2/2");
    expect(s).toContain("黒勝率");
  });

  it("distinct < 局数 のときは警告行が出る", () => {
    const s = formatBenchGameStats(
      computeBenchGameStats([game(base), game(base)]),
    );
    expect(s).toContain("⚠");
  });
});
