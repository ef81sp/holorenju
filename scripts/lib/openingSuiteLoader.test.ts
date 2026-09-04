import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadOpeningSuite,
  parseOpeningMoves,
  parseOpeningSuite,
} from "./openingSuiteLoader.ts";

const FIXTURE = path.join(
  import.meta.dirname,
  "__fixtures__",
  "opening-suite-small.json",
);

describe("parseOpeningMoves", () => {
  it("棋譜表記を Position に変換する（H8 = row 7, col 7、左下原点）", () => {
    expect(parseOpeningMoves("H8")).toEqual([{ row: 7, col: 7 }]);
    expect(parseOpeningMoves("A1 O15")).toEqual([
      { row: 14, col: 0 },
      { row: 0, col: 14 },
    ]);
  });

  it("空白の連続・前後空白を許容する", () => {
    expect(parseOpeningMoves("  H8   I9 ")).toEqual([
      { row: 7, col: 7 },
      { row: 6, col: 8 },
    ]);
  });

  it("盤外・不正表記・重複座標・空文字は例外", () => {
    expect(() => parseOpeningMoves("P8")).toThrow(/不正/);
    expect(() => parseOpeningMoves("H16")).toThrow(/不正/);
    expect(() => parseOpeningMoves("H0")).toThrow(/不正/);
    expect(() => parseOpeningMoves("h8")).toThrow(/不正/);
    expect(() => parseOpeningMoves("H8 I9 H8")).toThrow(/重複/);
    expect(() => parseOpeningMoves("")).toThrow(/空/);
  });
});

describe("parseOpeningSuite", () => {
  it("JSON → OpeningSource[]（順序と id を保つ）", () => {
    const suite = parseOpeningSuite({
      version: 1,
      openings: [
        { id: "a", root: null, parent: "", moves: "H8 I9 G7", score: 0 },
        { id: "b", root: "花月", parent: "", moves: "H8 I9", score: 3 },
      ],
    });
    expect(suite.version).toBe(1);
    expect(suite.openings.map((o) => o.id)).toEqual(["a", "b"]);
    expect(suite.openings[0]!.positions).toEqual([
      { row: 7, col: 7 },
      { row: 6, col: 8 },
      { row: 8, col: 6 },
    ]);
  });

  it("形が違えば例外（version 欠落 / openings 非配列 / id 重複 / moves 不正）", () => {
    expect(() => parseOpeningSuite({ openings: [] })).toThrow(/version/);
    expect(() => parseOpeningSuite({ version: 1, openings: {} })).toThrow(
      /openings/,
    );
    expect(() =>
      parseOpeningSuite({
        version: 1,
        openings: [
          { id: "a", moves: "H8" },
          { id: "a", moves: "I9" },
        ],
      }),
    ).toThrow(/重複/);
    expect(() =>
      parseOpeningSuite({ version: 1, openings: [{ id: "a", moves: "Z9" }] }),
    ).toThrow(/a/);
    expect(() =>
      parseOpeningSuite({ version: 1, openings: [{ id: 1, moves: "H8" }] }),
    ).toThrow(/id/);
    expect(() => parseOpeningSuite(null)).toThrow(/オブジェクト/);
  });

  it("空スイートは例外", () => {
    expect(() => parseOpeningSuite({ version: 1, openings: [] })).toThrow(/空/);
  });
});

describe("loadOpeningSuite", () => {
  it("フィクスチャを読み、file/version/count/openings を返す", () => {
    const loaded = loadOpeningSuite(FIXTURE, "/nonexistent-root");
    expect(loaded.version).toBe(1);
    expect(loaded.count).toBe(3);
    expect(loaded.openings.map((o) => o.id)).toEqual([
      "fx-0001",
      "fx-0002",
      "fx-0003",
    ]);
    expect(loaded.openings[0]!.positions).toHaveLength(7);
    expect(loaded.openings[0]!.positions[0]).toEqual({ row: 7, col: 7 });
    expect(loaded.file).toBe(FIXTURE);
  });

  it("相対パスは rootDir 基準で解決する", () => {
    const rel = path.relative(process.cwd(), FIXTURE);
    const loaded = loadOpeningSuite(rel, process.cwd());
    expect(loaded.count).toBe(3);
    expect(loaded.file).toBe(rel);
  });

  it("存在しないファイルは例外", () => {
    expect(() => loadOpeningSuite("no-such.json", "/nonexistent-root")).toThrow(
      /no-such\.json/,
    );
  });
});
