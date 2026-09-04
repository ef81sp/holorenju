import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadOpeningSuite,
  parseOpeningMoves,
  parseOpeningSuite,
  resolveOpenings,
  toOpeningSuiteConfig,
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

describe("resolveOpenings", () => {
  const base = {
    openingOffset: 0,
    sets: 1,
    randomFactor: undefined,
    rootDir: "/nonexistent-root",
  };

  it("--openings 未指定なら珠型 26×2 局、config は undefined、warn 無し", () => {
    const r = resolveOpenings({ ...base, openings: undefined });
    expect(r.suite).toBeNull();
    expect(r.tasks).toHaveLength(52);
    expect(r.totalGames).toBe(52);
    expect(r.untruncatedGames).toBe(52);
    expect(r.gamesPerSet).toBe(52);
    expect(r.config).toBeUndefined();
    expect(r.warnings).toEqual([]);
    expect(r.summaryLines).toEqual(["セット数: 1 (52局/セット, 計52局)"]);
  });

  it("スイート + offset + sets: 周回ごとに (count−offset)×2 局、config を組み立てる", () => {
    const r = resolveOpenings({
      ...base,
      openings: FIXTURE,
      openingOffset: 1,
      sets: 2,
    });
    expect(r.suite?.count).toBe(3);
    expect(r.tasks.map((t) => t.pairId)).toEqual([
      "0:fx-0002",
      "0:fx-0002",
      "0:fx-0003",
      "0:fx-0003",
      "1:fx-0002",
      "1:fx-0002",
      "1:fx-0003",
      "1:fx-0003",
    ]);
    expect(r.gamesPerSet).toBe(4);
    expect(r.config).toEqual({
      file: FIXTURE,
      version: 1,
      count: 3,
      offset: 1,
    });
    expect(r.summaryLines[0]).toMatch(/3 開局, offset=1 → 2 開局使用/);
    expect(r.summaryLines[1]).toBe("周回数: 2 (4局/周, 計8局)");
    // sets>1 かつ randomFactor 無し → warn
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/同一棋譜/);
  });

  it("maxGames はペア境界で切り、untruncatedGames は切り詰め前の長さ", () => {
    const r = resolveOpenings({
      ...base,
      openings: FIXTURE,
      sets: 2,
      maxGames: 4,
      randomFactor: 0.02,
    });
    expect(r.totalGames).toBe(4);
    expect(r.untruncatedGames).toBe(12);
    expect(r.gamesPerSet).toBe(6);
    expect(r.summaryLines.at(-1)).toBe(
      "--max-games=4 指定により 12→4 局に切り詰め",
    );
    expect(r.warnings).toEqual([]);
  });

  it("フラグ不整合・読込失敗・タスク 0 件は throw（process.exit しない）", () => {
    expect(() =>
      resolveOpenings({ ...base, openings: FIXTURE, bookA: true }),
    ).toThrow(/--book-a/);
    expect(() =>
      resolveOpenings({ ...base, openings: undefined, openingOffset: 2 }),
    ).toThrow(/--opening-offset/);
    expect(() =>
      resolveOpenings({ ...base, openings: "no-such.json" }),
    ).toThrow(/no-such\.json/);
    expect(() =>
      resolveOpenings({ ...base, openings: FIXTURE, openingOffset: 3 }),
    ).toThrow(/0 件/);
  });
});

describe("toOpeningSuiteConfig", () => {
  it("file/version/count/offset を写す", () => {
    const suite = loadOpeningSuite(FIXTURE, "/nonexistent-root");
    expect(toOpeningSuiteConfig(suite, 2)).toEqual({
      file: FIXTURE,
      version: 1,
      count: 3,
      offset: 2,
    });
  });
});
