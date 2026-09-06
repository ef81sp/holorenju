import { describe, expect, it } from "vitest";

import type { CommitGameResult } from "../types/commit-bench.ts";

import { compareBenchRuns, formatBenchComparison } from "./benchCompare.ts";

function game(
  pairId: string,
  isABlack: boolean,
  moves: {
    row: number;
    col: number;
    nodes?: number;
    score?: number;
    depth?: number;
  }[],
): CommitGameResult {
  return {
    playerA: "A",
    playerB: "B",
    winner: "A",
    reason: "five",
    moves: moves.length,
    duration: 0,
    isABlack,
    jushuName: pairId.split(":")[1] ?? pairId,
    pairId,
    moveHistory: moves.map((m, i) => ({
      row: m.row,
      col: m.col,
      time: 0,
      isOpening: i < 1,
      score: m.score,
      depth: m.depth,
      stats: m.nodes === undefined ? undefined : { nodes: m.nodes },
    })),
  };
}

const base = [
  game("0:o1", true, [
    { row: 7, col: 7 },
    { row: 7, col: 8, nodes: 100, score: 5, depth: 4 },
    { row: 8, col: 8, nodes: 200, score: -3, depth: 5 },
  ]),
  game("0:o1", false, [
    { row: 7, col: 7 },
    { row: 6, col: 6, nodes: 50, score: 1 },
  ]),
];

describe("compareBenchRuns", () => {
  it("棋譜・nodes・score が全ペアで一致すれば identical", () => {
    const r = compareBenchRuns(
      { games: base },
      { games: structuredClone(base) },
    );
    expect(r.identical).toBe(true);
    expect(r.comparedGames).toBe(2);
    expect(r.mismatches).toEqual([]);
    expect(r.missingInA).toEqual([]);
    expect(r.missingInB).toEqual([]);
  });

  it("着手が違えば最初の不一致手を報告する", () => {
    const b = structuredClone(base);
    b[0]!.moveHistory[2] = { ...b[0]!.moveHistory[2]!, row: 9 };
    const r = compareBenchRuns({ games: base }, { games: b });
    expect(r.identical).toBe(false);
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]).toMatchObject({
      pairId: "0:o1",
      isABlack: true,
      moveIndex: 2,
      field: "move",
    });
  });

  it("nodes が違えば field=nodes（時計依存の検出）", () => {
    const b = structuredClone(base);
    b[0]!.moveHistory[1]!.stats = { nodes: 101 };
    const r = compareBenchRuns({ games: base }, { games: b });
    expect(r.mismatches[0]).toMatchObject({ moveIndex: 1, field: "nodes" });
    expect(r.mismatches[0]?.a).toBe("100");
    expect(r.mismatches[0]?.b).toBe("101");
  });

  it("score が違えば field=score", () => {
    const b = structuredClone(base);
    b[1]!.moveHistory[1]!.score = 2;
    const r = compareBenchRuns({ games: base }, { games: b });
    expect(r.mismatches[0]).toMatchObject({
      pairId: "0:o1",
      isABlack: false,
      moveIndex: 1,
      field: "score",
    });
  });

  it("completedDepth が違えば field=depth", () => {
    const b = structuredClone(base);
    b[0]!.moveHistory[2]!.depth = 6;
    const r = compareBenchRuns({ games: base }, { games: b });
    expect(r.mismatches[0]).toMatchObject({ moveIndex: 2, field: "depth" });
    expect(r.mismatches[0]?.a).toBe("5");
    expect(r.mismatches[0]?.b).toBe("6");
  });

  it("手数が違えば短い方の末尾の次で length 不一致", () => {
    const b = structuredClone(base);
    b[1]!.moveHistory.push({ row: 1, col: 1, time: 0, isOpening: false });
    const r = compareBenchRuns({ games: base }, { games: b });
    expect(r.mismatches[0]).toMatchObject({ moveIndex: 2, field: "length" });
  });

  it("片方にしか無い局は missing として報告し identical=false", () => {
    const r = compareBenchRuns({ games: base }, { games: [base[0]!] });
    expect(r.identical).toBe(false);
    expect(r.missingInB).toEqual(["0:o1/A白"]);
    expect(r.comparedGames).toBe(1);
  });

  it("並び順が違っても pairId+色で突き合わせる", () => {
    const r = compareBenchRuns(
      { games: base },
      { games: [base[1]!, base[0]!] },
    );
    expect(r.identical).toBe(true);
  });

  it("両方 stats 無し（旧 JSON）は nodes を比較しない", () => {
    const a = [
      game("0:x", true, [
        { row: 7, col: 7 },
        { row: 1, col: 1 },
      ]),
    ];
    const r = compareBenchRuns({ games: a }, { games: structuredClone(a) });
    expect(r.identical).toBe(true);
  });

  it("一方だけ stats 無しは nodes 不一致", () => {
    const b = structuredClone(base);
    b[0]!.moveHistory[1]!.stats = undefined;
    const r = compareBenchRuns({ games: base }, { games: b });
    expect(r.mismatches[0]).toMatchObject({ field: "nodes" });
  });

  it("pairId の無い旧 JSON は比較できない旨を error", () => {
    const a = [{ ...base[0]!, pairId: undefined }];
    expect(() => compareBenchRuns({ games: a }, { games: a })).toThrow(
      /pairId/,
    );
  });
});

describe("formatBenchComparison", () => {
  it("一致なら ✓ 行", () => {
    const r = compareBenchRuns(
      { games: base },
      { games: structuredClone(base) },
    );
    expect(formatBenchComparison(r)).toMatch(/完全一致/);
  });
  it("不一致なら最初の手を表示", () => {
    const b = structuredClone(base);
    b[0]!.moveHistory[1]!.stats = { nodes: 999 };
    const r = compareBenchRuns({ games: base }, { games: b });
    const text = formatBenchComparison(r);
    expect(text).toMatch(/0:o1/);
    expect(text).toMatch(/nodes/);
    expect(text).toMatch(/100/);
    expect(text).toMatch(/999/);
  });
});
