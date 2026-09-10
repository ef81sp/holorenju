/**
 * prospectCorpusRows.ts のテスト（eval-r4-2026-09-11.md §2 A1 (4)）:
 * JSONL 読み込み（破棄行スキップ）、源 kind の選別、源 kind × 月のセグメント、
 * fold 平均 val 損失のセグメント集計。
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { CorpusRow, CorpusSource } from "../types/prospectCorpus.ts";

import {
  filterRowsBySourceKind,
  formatSegmentLoss,
  parseKindList,
  readCorpusRows,
  segmentKey,
  sourceMonth,
  summarizeSegmentLoss,
} from "./prospectCorpusRows.ts";
import { meanSquaredLoss } from "./texelFit.ts";

function rowOf(source: CorpusSource, features: number[] = [1]): CorpusRow {
  return {
    key: `${source.kind}-${source.file}-${source.gameIdx}-${source.ply}`,
    source,
    stm: "black",
    black: [],
    white: [],
    features,
    outcome: 0.5,
  };
}

const KIFU_06: CorpusSource = {
  kind: "kifu",
  file: "commit-bench-2026-06-10T01-51-00-851Z.json",
  gameIdx: 0,
  ply: 8,
  jushu: "x",
};
const KIFU_09: CorpusSource = {
  kind: "kifu",
  file: "weight-bench-2026-09-09T16-21-38-262Z.json",
  gameIdx: 3,
  ply: 8,
  jushu: "x",
};
const BOOK: CorpusSource = {
  kind: "book",
  file: "opening-book-hard.json",
  gameIdx: 0,
  ply: 7,
  jushu: "",
};
const PREFIX: CorpusSource = {
  kind: "prefix",
  file: "opening-suite-v1.json",
  gameIdx: 0,
  ply: 5,
  jushu: "s1-0001",
};

describe("readCorpusRows", () => {
  it("JSONL を読み、空行と dropped 行を除く", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "corpus-rows-"));
    const file = path.join(dir, "c.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify(rowOf(KIFU_06)),
        "",
        JSON.stringify({ key: "k", dropped: "evalCap", rapfiEval: 5000 }),
        JSON.stringify({ ...rowOf(BOOK), rapfiEval: 12 }),
        "",
      ].join("\n"),
    );
    const rows = readCorpusRows(file);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.source.kind).toBe("kifu");
    expect(rows[1]!.rapfiEval).toBe(12);
  });
});

describe("sourceMonth / segmentKey", () => {
  it("kifu はファイル名の YYYY-MM、book/prefix は月なし", () => {
    expect(sourceMonth(KIFU_06.file)).toBe("2026-06");
    expect(sourceMonth(KIFU_09.file)).toBe("2026-09");
    expect(sourceMonth("no-date.json")).toBeNull();
    expect(segmentKey(KIFU_06)).toBe("kifu/2026-06");
    expect(segmentKey(KIFU_09)).toBe("kifu/2026-09");
    expect(segmentKey(BOOK)).toBe("book");
    expect(segmentKey(PREFIX)).toBe("prefix");
  });
});

describe("parseKindList / filterRowsBySourceKind", () => {
  it("カンマ区切りの kind を検証して返す（未指定は空）", () => {
    expect(parseKindList(undefined)).toEqual([]);
    expect(parseKindList("kifu")).toEqual(["kifu"]);
    expect(parseKindList("book, prefix")).toEqual(["book", "prefix"]);
    expect(() => parseKindList("kifu,bogus")).toThrow(/bogus/);
  });

  it("include は指定 kind のみ、exclude は指定 kind を除く。両方なら include 後に exclude", () => {
    const rows = [rowOf(KIFU_06), rowOf(KIFU_09), rowOf(BOOK), rowOf(PREFIX)];
    expect(filterRowsBySourceKind(rows, [], [])).toHaveLength(4);
    expect(
      filterRowsBySourceKind(rows, ["kifu"], []).map((r) => r.source.kind),
    ).toEqual(["kifu", "kifu"]);
    expect(
      filterRowsBySourceKind(rows, [], ["book"]).map((r) => r.source.kind),
    ).toEqual(["kifu", "kifu", "prefix"]);
    expect(
      filterRowsBySourceKind(rows, ["kifu", "book"], ["book"]).map(
        (r) => r.source.kind,
      ),
    ).toEqual(["kifu", "kifu"]);
  });
});

describe("summarizeSegmentLoss", () => {
  it("セグメントごとに全体 baseline 損失と fold 平均 val 損失（val に含まれる fold のみ）を出す", () => {
    // 1 特徴・K=1。行 0,1 = kifu/2026-06、行 2 = book、行 3 = prefix
    const segments = ["kifu/2026-06", "kifu/2026-06", "book", "prefix"];
    const X = [[1], [2], [3], [4]];
    const labels = [0.6, 0.7, 0.8, 0.9];
    const K = 1;
    const baseline = [0.5];
    // fold0: val = 行 0,2 / fold1: val = 行 1,3
    const folds = [
      { train: [1, 3], val: [0, 2] },
      { train: [0, 2], val: [1, 3] },
    ];
    const foldWeights = [[0.4], [0.6]];
    const out = summarizeSegmentLoss({
      segments,
      X,
      labels,
      folds,
      foldWeights,
      baselineWeights: baseline,
      K,
    });
    expect(out.map((s) => s.segment)).toEqual([
      "kifu/2026-06",
      "book",
      "prefix",
    ]);
    const kifu = out[0]!;
    expect(kifu.rowCount).toBe(2);
    expect(kifu.baselineLoss).toBeCloseTo(
      meanSquaredLoss([[1], [2]], [0.6, 0.7], baseline, K),
      12,
    );
    // fold0 では行 0、fold1 では行 1 が val
    const v0 = meanSquaredLoss([[1]], [0.6], [0.4], K);
    const v1 = meanSquaredLoss([[2]], [0.7], [0.6], K);
    expect(kifu.avgValLoss).toBeCloseTo((v0 + v1) / 2, 12);
    expect(kifu.foldCount).toBe(2);
    const book = out[1]!;
    expect(book.rowCount).toBe(1);
    expect(book.foldCount).toBe(1);
    expect(book.avgValLoss).toBeCloseTo(
      meanSquaredLoss([[3]], [0.8], [0.4], K),
      12,
    );
  });

  it("どの fold の val にも出ないセグメントは avgValLoss null", () => {
    const out = summarizeSegmentLoss({
      segments: ["book"],
      X: [[1]],
      labels: [0.5],
      folds: [{ train: [0], val: [] }],
      foldWeights: [[0.1]],
      baselineWeights: [0.5],
      K: 1,
    });
    expect(out[0]!.avgValLoss).toBeNull();
    expect(out[0]!.foldCount).toBe(0);
  });

  it("formatSegmentLoss は表形式（セグメント・行数・baseline・val）", () => {
    const text = formatSegmentLoss([
      {
        segment: "kifu/2026-06",
        rowCount: 10,
        baselineLoss: 0.1234567,
        avgValLoss: 0.1111111,
        foldCount: 5,
      },
      {
        segment: "book",
        rowCount: 3,
        baselineLoss: 0.2,
        avgValLoss: null,
        foldCount: 0,
      },
    ]);
    expect(text).toContain("kifu/2026-06");
    expect(text).toContain("0.123457");
    expect(text).toContain("0.111111");
    expect(text).toMatch(/book.*-/);
  });
});
