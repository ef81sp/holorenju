import { describe, expect, it } from "vitest";

import type { CommitGameResult } from "../types/commit-bench.ts";

import { type MergeableBenchJson, mergeBenchRuns } from "./benchMerge.ts";

function game(pairId: string, isABlack: boolean): CommitGameResult {
  return {
    playerA: "A",
    playerB: "B",
    winner: "A",
    reason: "five",
    moves: 0,
    duration: 0,
    isABlack,
    jushuName: pairId,
    pairId,
    moveHistory: [],
  };
}

const commitA = {
  sha: "a".repeat(40),
  shortSha: "aaaaaaa",
  message: "",
  date: "",
};
const commitB = {
  sha: "b".repeat(40),
  shortSha: "bbbbbbb",
  message: "",
  date: "",
};

function run(
  pairIds: string[],
  overrides: Partial<MergeableBenchJson> = {},
): MergeableBenchJson {
  return {
    type: "commit-bench",
    commitA,
    commitB,
    config: {
      difficulty: "hard",
      sets: 1,
      fixedNodes: 1_200_000,
      openings: {
        file: "scripts/data/opening-suite-v2.json",
        version: 2,
        count: 382,
        offset: 0,
      },
    },
    games: pairIds.flatMap((p) => [game(p, true), game(p, false)]),
    ...overrides,
  };
}

describe("mergeBenchRuns", () => {
  it("同一 commitA/commitB/設定なら games を順に結合する", () => {
    const first = run(["s1", "s2"]);
    const second = run(["s3"], {
      config: {
        ...first.config!,
        openings: { ...first.config!.openings!, offset: 2 },
      },
    });
    const merged = mergeBenchRuns([first, second]);
    expect(merged.games.map((g) => g.pairId)).toEqual([
      "s1",
      "s1",
      "s2",
      "s2",
      "s3",
      "s3",
    ]);
    expect(merged.header).toContain("aaaaaaa");
    expect(merged.header).toContain("bbbbbbb");
  });

  it("1 本だけでも結合できる（結果は同じ）", () => {
    expect(mergeBenchRuns([run(["s1"])]).games).toHaveLength(2);
  });

  it("commitA/commitB が違えばエラー", () => {
    const other = run(["s3"], {
      commitB: { ...commitB, sha: "c".repeat(40), shortSha: "ccccccc" },
    });
    expect(() => mergeBenchRuns([run(["s1"]), other])).toThrow(/commitB/);
  });

  it("fixedNodes / difficulty / openings.file が違えばエラー", () => {
    const base = run(["s1"]);
    expect(() =>
      mergeBenchRuns([
        base,
        run(["s2"], { config: { ...base.config!, fixedNodes: 6000 } }),
      ]),
    ).toThrow(/fixedNodes/);
    expect(() =>
      mergeBenchRuns([
        base,
        run(["s2"], { config: { ...base.config!, difficulty: "easy" } }),
      ]),
    ).toThrow(/difficulty/);
    expect(() =>
      mergeBenchRuns([
        base,
        run(["s2"], {
          config: {
            ...base.config!,
            openings: { ...base.config!.openings!, file: "v1.json" },
          },
        }),
      ]),
    ).toThrow(/openings/);
  });

  it("weight-bench は weights が違えばエラー、同じなら結合できる", () => {
    const wb = (
      pairIds: string[],
      weights: Record<string, number>,
    ): MergeableBenchJson =>
      run(pairIds, {
        type: "weight-bench",
        commitA: undefined,
        commitB: undefined,
        weights,
      });
    expect(
      mergeBenchRuns([
        wb(["s1"], { OPEN_THREE: 600 }),
        wb(["s2"], { OPEN_THREE: 600 }),
      ]).games,
    ).toHaveLength(4);
    expect(() =>
      mergeBenchRuns([
        wb(["s1"], { OPEN_THREE: 600 }),
        wb(["s2"], { OPEN_THREE: 700 }),
      ]),
    ).toThrow(/weights/);
  });

  it("type が違えばエラー", () => {
    expect(() =>
      mergeBenchRuns([run(["s1"]), run(["s2"], { type: "weight-bench" })]),
    ).toThrow(/type/);
  });

  it("同じ pairId+色 の局が重複していればエラー（前後半が重なっている）", () => {
    expect(() => mergeBenchRuns([run(["s1", "s2"]), run(["s2"])])).toThrow(
      /s2/,
    );
  });

  it("games の無い JSON はエラー", () => {
    expect(() => mergeBenchRuns([run([]), run(["s1"])])).toThrow(/games/);
  });
});
