/**
 * openingSuiteReport.ts（gen-opening-suite の stderr レポート / stats.parents）のテスト。
 */
import { describe, expect, it } from "vitest";

import type { OpeningSuiteEntry } from "../types/openingSuite.ts";

import {
  histogramLines,
  parentStats,
  timingLine,
} from "./openingSuiteReport.ts";

const entry = (id: string, parent: string): OpeningSuiteEntry => ({
  id,
  root: null,
  parent,
  moves: "H8 I9 I8 G8 H7 G6 I7",
  score: 0,
});

describe("parentStats", () => {
  it("親ごとの件数を数え、件数 → 親の数のヒストグラムにする", () => {
    const openings = [
      entry("1", "A"),
      entry("2", "A"),
      entry("3", "A"),
      entry("4", "B"),
      entry("5", "C"),
    ];
    expect(parentStats(openings)).toEqual({
      count: 3,
      histogram: { "3": 1, "1": 2 },
    });
  });
  it("空なら count 0", () => {
    expect(parentStats([])).toEqual({ count: 0, histogram: {} });
  });
});

describe("timingLine", () => {
  it("p50 / p90 / max を秒で出す。空なら null", () => {
    expect(timingLine([])).toBeNull();
    const line = timingLine([1000, 2000, 3000, 4000, 10000]);
    expect(line).toContain("p50 3.0");
    expect(line).toContain("max 10.0");
  });
});

describe("histogramLines", () => {
  it("しきい値以下は accepted、超えは score-pass で表示する", () => {
    const lines = histogramLines(
      [
        {
          score: 100,
          bestMove: "H9",
          reject: null,
          elapsedMs: 1,
          candidate: { key: "k", parent: "P", root: null },
        },
      ],
      300,
    );
    expect(lines.some((l) => l.includes("|score| <=  300: accepted 1"))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes("|score| <=  400: score-pass 1"))).toBe(
      true,
    );
  });
});
