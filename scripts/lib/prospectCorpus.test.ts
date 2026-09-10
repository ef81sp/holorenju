/**
 * prospectCorpus.ts（コーパス抽出の共通部）のテスト。
 * docs/plans/eval-r4-2026-09-11.md §2 A1: 両 JSON 形のローダ、quiet フィルタ +
 * 特徴抽出 + dedup の一本化（tryEmitQuietPosition）、盤面キーのブック形式統一、
 * 回帰ゲート局面の除外、源 × ply 帯 × 手番の行数表。
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { boardToString } from "@/logic/boardSymmetry";
import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import { createBoardFromRecord } from "@/logic/gameRecordParser";

import type { CorpusRow } from "../types/prospectCorpus.ts";

import { PROSPECT_FEATURE_COUNT } from "./evalParams.ts";
import { parseBoardKey } from "./openingSuite.ts";
import { parseOpeningSuite } from "./openingSuiteLoader.ts";
import {
  boardKey,
  createFilterStats,
  createRowTable,
  formatRowTable,
  hasImmediateFive,
  parseBenchGames,
  plyBand,
  type QuietEmitContext,
  readBenchGames,
  regressionPositionKeys,
  sampleBook,
  sampleGame,
  samplePrefix,
  tallyRow,
  tryEmitQuietPosition,
} from "./prospectCorpus.ts";
import { REGRESSION_POSITIONS } from "./regressionPositions.ts";

const FIXTURES = path.join(import.meta.dirname, "__fixtures__");
const CORPUS_FIXTURES = path.join(FIXTURES, "prospect-corpus");

type WasmModule = Awaited<ReturnType<typeof loadWasmModule>>;
let loadedWasm: WasmModule | null = null;
beforeAll(async () => {
  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  loadedWasm = await loadWasmModule();
});
function wasm(): WasmModule {
  if (loadedWasm === null) {
    throw new Error("wasm が未ロード");
  }
  return loadedWasm;
}

function createContext(): QuietEmitContext & { rows: CorpusRow[] } {
  const rows: CorpusRow[] = [];
  return {
    wasm: wasm(),
    seen: new Set<string>(),
    excluded: new Set<string>(),
    stats: createFilterStats(),
    emit: (row) => rows.push(row),
    rows,
  };
}

describe("readBenchGames / parseBenchGames — 両 JSON 形", () => {
  it("commit-bench 形（{games:[...]}）を読む", () => {
    const games = readBenchGames(
      path.join(CORPUS_FIXTURES, "commit-bench-form.json"),
    );
    expect(games).toHaveLength(2);
    expect(games[0]!.jushuName).toBe("長星");
    expect(games[0]!.moveHistory).toHaveLength(6);
    expect(games[1]!.winner).toBe("draw");
  });

  it("weight-bench 形（トップレベル配列）を読む", () => {
    const games = readBenchGames(
      path.join(CORPUS_FIXTURES, "weight-bench-array-form.json"),
    );
    expect(games).toHaveLength(1);
    expect(games[0]!.winner).toBe("B");
    expect(games[0]!.isABlack).toBe(true);
  });

  it("valid:false の run は空（決定的モードで abort があった run を除外）", () => {
    expect(
      readBenchGames(path.join(CORPUS_FIXTURES, "invalid-run.json")),
    ).toEqual([]);
  });

  it("games を持たない JSON は空", () => {
    expect(readBenchGames(path.join(CORPUS_FIXTURES, "no-games.json"))).toEqual(
      [],
    );
  });

  it("形が不正なら例外（黙って 0 局にしない）", () => {
    expect(() => parseBenchGames("x", "not-an-object")).toThrow(/形/);
    expect(() =>
      parseBenchGames({ games: [{ winner: "A" }] }, "broken"),
    ).toThrow(/moveHistory/);
  });
});

describe("boardKey — ブック形式（boardToString + `|` + 手番）", () => {
  it("parseBoardKey で往復できる", () => {
    const { board } = createBoardFromRecord("H8 I9 I8 G8");
    const key = boardKey(board, "black");
    expect(key).toBe(`${boardToString(board)}|black`);
    expect(key.startsWith("b:")).toBe(false);
    const back = parseBoardKey(key);
    expect(back.sideToMove).toBe("black");
    expect(boardToString(back.board)).toBe(boardToString(board));
  });
});

describe("hasImmediateFive", () => {
  it("四を持つ側だけ true", () => {
    const { board } = createBoardFromRecord("G8 A1 H8 C1 I8 E1 J8 G1");
    expect(hasImmediateFive(board, "black")).toBe(true);
    expect(hasImmediateFive(board, "white")).toBe(false);
  });
});

describe("plyBand", () => {
  it("4-6 / 7 / 8-15 / 16-25 / 26+ に分ける（4 未満は <4）", () => {
    expect(plyBand(3)).toBe("<4");
    expect(plyBand(4)).toBe("4-6");
    expect(plyBand(6)).toBe("4-6");
    expect(plyBand(7)).toBe("7");
    expect(plyBand(8)).toBe("8-15");
    expect(plyBand(15)).toBe("8-15");
    expect(plyBand(16)).toBe("16-25");
    expect(plyBand(25)).toBe("16-25");
    expect(plyBand(26)).toBe("26+");
    expect(plyBand(60)).toBe("26+");
  });
});

describe("tryEmitQuietPosition — quiet フィルタ + 特徴 + dedup + emit", () => {
  const source = {
    kind: "kifu" as const,
    file: "commit-bench-2026-06-10T00-00-00-000Z.json",
    gameIdx: 0,
    ply: 4,
    jushu: "長星",
  };

  it("quiet 局面を emit し、key/stm/石/特徴 34 個を持つ", () => {
    const ctx = createContext();
    const { board } = createBoardFromRecord("H8 I9 I8 G8");
    expect(tryEmitQuietPosition(ctx, board, "black", source, 1)).toBe(true);
    expect(ctx.rows).toHaveLength(1);
    const row = ctx.rows[0]!;
    expect(row.key).toBe(boardKey(board, "black"));
    expect(row.stm).toBe("black");
    expect(row.source).toEqual(source);
    expect(row.outcome).toBe(1);
    expect(row.black).toHaveLength(2);
    expect(row.white).toHaveLength(2);
    expect(row.features).toHaveLength(PROSPECT_FEATURE_COUNT);
    expect(row.features.every((f) => Number.isInteger(f))).toBe(true);
    expect(ctx.stats.emitted).toBe(1);
    expect(ctx.stats.candidates).toBe(1);
    expect(ctx.seen.has(row.key)).toBe(true);
    // 盤面は変更しない（作業用の着手は戻す）
    expect(boardToString(board)).toBe(
      boardToString(parseBoardKey(row.key).board),
    );
  });

  it("同一局面の再投入は rejectedDup", () => {
    const ctx = createContext();
    const { board } = createBoardFromRecord("H8 I9 I8 G8");
    expect(tryEmitQuietPosition(ctx, board, "black", source, 0.5)).toBe(true);
    expect(tryEmitQuietPosition(ctx, board, "black", source, 0.5)).toBe(false);
    expect(ctx.stats.rejectedDup).toBe(1);
    expect(ctx.rows).toHaveLength(1);
  });

  it("手番側に即五があれば rejectedFiveStm、相手側なら rejectedFiveOpp", () => {
    const ctx = createContext();
    const four = createBoardFromRecord("G8 A1 H8 C1 I8 E1 J8 G1").board;
    expect(tryEmitQuietPosition(ctx, four, "black", source, 0.5)).toBe(false);
    expect(ctx.stats.rejectedFiveStm).toBe(1);
    const fourOpp = createBoardFromRecord("G8 A1 H8 C1 I8 E1 J8").board;
    expect(tryEmitQuietPosition(ctx, fourOpp, "white", source, 0.5)).toBe(
      false,
    );
    expect(ctx.stats.rejectedFiveOpp).toBe(1);
    expect(ctx.rows).toHaveLength(0);
  });

  it("手番側に VCF（活三 → 活四 → 五）があれば rejectedVcf", () => {
    const ctx = createContext();
    const { board } = createBoardFromRecord("G8 A1 H8 A2 I8 B1");
    expect(tryEmitQuietPosition(ctx, board, "black", source, 0.5)).toBe(false);
    expect(ctx.stats.rejectedVcf).toBe(1);
  });

  it("excluded（回帰ゲート局面）に含まれる key は rejectedRegression", () => {
    const ctx = createContext();
    const { board } = createBoardFromRecord("H8 I9 I8 G8");
    ctx.excluded.add(boardKey(board, "black"));
    expect(tryEmitQuietPosition(ctx, board, "black", source, 0.5)).toBe(false);
    expect(ctx.stats.rejectedRegression).toBe(1);
    expect(ctx.stats.rejectedDup).toBe(0);
    expect(ctx.rows).toHaveLength(0);
  });
});

describe("regressionPositionKeys — 回帰ゲート局面の統一 key", () => {
  it("REGRESSION_POSITIONS の各 kifuPrefix を再生した key を返す", () => {
    const keys = regressionPositionKeys();
    expect(keys).toHaveLength(REGRESSION_POSITIONS.length);
    const j6 = REGRESSION_POSITIONS.find(
      (p) => p.id === "p6-white-j6-collapse",
    )!;
    const { board } = createBoardFromRecord(j6.kifuPrefix);
    expect(keys).toContain(boardKey(board, "white"));
    for (const key of keys) {
      expect(() => parseBoardKey(key)).not.toThrow();
    }
  });
});

describe("sampleGame — 棋譜からのサンプリング", () => {
  const file = "commit-bench-2026-06-10T00-00-00-000Z.json";

  it("minPly 以降・終局 endMargin 手前まで、sampleInterval 間隔で最大 maxPerGame 局面", () => {
    const ctx = createContext();
    const game = readBenchGames(
      path.join(CORPUS_FIXTURES, "commit-bench-form.json"),
    )[0]!;
    // 6 手の棋譜。minPly=2, endMargin=1 → ply 2..5 が候補
    sampleGame(ctx, game, file, 0, {
      minPly: 2,
      endMargin: 1,
      sampleInterval: 1,
      maxPerGame: 12,
    });
    const plies = ctx.rows.map((r) => r.source.ply);
    expect(plies).toEqual([2, 3, 4, 5]);
    expect(ctx.rows.map((r) => r.stm)).toEqual([
      "black",
      "white",
      "black",
      "white",
    ]);
    // winner=A, isABlack=true → 黒勝ち。stm 視点の outcome
    expect(ctx.rows.map((r) => r.outcome)).toEqual([1, 0, 1, 0]);
    for (const row of ctx.rows) {
      expect(row.source).toMatchObject({ kind: "kifu", file, gameIdx: 0 });
      expect(row.source.jushu).toBe("長星");
      expect(row.black.length + row.white.length).toBe(row.source.ply);
    }
  });

  it("sampleInterval / maxPerGame で間引く", () => {
    const ctx = createContext();
    const game = readBenchGames(
      path.join(CORPUS_FIXTURES, "commit-bench-form.json"),
    )[0]!;
    sampleGame(ctx, game, file, 0, {
      minPly: 2,
      endMargin: 1,
      sampleInterval: 2,
      maxPerGame: 1,
    });
    expect(ctx.rows.map((r) => r.source.ply)).toEqual([2]);
  });

  it("引き分けは outcome 0.5、白勝ちは白番 1", () => {
    const ctx = createContext();
    const games = readBenchGames(
      path.join(CORPUS_FIXTURES, "commit-bench-form.json"),
    );
    sampleGame(ctx, games[1]!, file, 1, {
      minPly: 2,
      endMargin: 0,
      sampleInterval: 1,
      maxPerGame: 12,
    });
    expect(ctx.rows.map((r) => r.outcome)).toEqual([0.5, 0.5]);
    const ctx2 = createContext();
    const whiteWin = readBenchGames(
      path.join(CORPUS_FIXTURES, "weight-bench-array-form.json"),
    )[0]!; // winner=B, isABlack=true → 白勝ち
    sampleGame(ctx2, whiteWin, file, 2, {
      minPly: 2,
      endMargin: 0,
      sampleInterval: 1,
      maxPerGame: 12,
    });
    // 5 手の棋譜 → ply 2..4 が候補
    expect(ctx2.rows.map((r) => [r.stm, r.outcome])).toEqual([
      ["black", 0],
      ["white", 1],
      ["black", 0],
    ]);
  });
});

describe("sampleBook — オープニングブック entries", () => {
  it("entries のキーを盤面に戻し、minPly 未満の石数を落として emit する", () => {
    const ctx = createContext();
    const b3 = createBoardFromRecord("H8 I9 I8").board;
    const b5 = createBoardFromRecord("H8 I9 I8 G8 H7").board;
    const entries: Record<string, unknown> = {
      [boardKey(b3, "white")]: { play: { move: "G8" } },
      [boardKey(b5, "white")]: { play: { move: "G6" } },
    };
    const emitted = sampleBook(ctx, entries, "opening-book-hard.json", {
      minPly: 4,
    });
    expect(emitted).toBe(1);
    expect(ctx.rows).toHaveLength(1);
    const row = ctx.rows[0]!;
    expect(row.key).toBe(boardKey(b5, "white"));
    expect(row.stm).toBe("white");
    expect(row.outcome).toBe(0.5);
    expect(row.source).toEqual({
      kind: "book",
      file: "opening-book-hard.json",
      gameIdx: 1,
      ply: 5,
      jushu: "",
    });
  });

  it("既出の局面は dedup される", () => {
    const ctx = createContext();
    const b5 = createBoardFromRecord("H8 I9 I8 G8 H7").board;
    ctx.seen.add(boardKey(b5, "white"));
    sampleBook(ctx, { [boardKey(b5, "white")]: {} }, "opening-book-hard.json", {
      minPly: 4,
    });
    expect(ctx.rows).toHaveLength(0);
    expect(ctx.stats.rejectedDup).toBe(1);
  });
});

describe("samplePrefix — 開局スイートの先頭 n 手", () => {
  it("各開局 × 各 ply の局面を emit する（黒番・白番の両方が出る）", () => {
    const ctx = createContext();
    const suite = parseOpeningSuite(
      JSON.parse(
        readFileSync(path.join(FIXTURES, "opening-suite-small.json"), "utf8"),
      ),
    );
    const emitted = samplePrefix(
      ctx,
      suite.openings,
      "opening-suite-small.json",
      [4, 5, 6],
      { minPly: 4 },
    );
    expect(emitted).toBe(ctx.rows.length);
    expect(ctx.rows.length).toBeGreaterThan(0);
    const kinds = new Set(ctx.rows.map((r) => r.source.kind));
    expect(kinds).toEqual(new Set(["prefix"]));
    const stms = new Set(ctx.rows.map((r) => r.stm));
    expect(stms).toEqual(new Set(["black", "white"]));
    for (const row of ctx.rows) {
      expect([4, 5, 6]).toContain(row.source.ply);
      expect(row.stm).toBe(row.source.ply % 2 === 0 ? "black" : "white");
      expect(row.black.length + row.white.length).toBe(row.source.ply);
      expect(row.source.file).toBe("opening-suite-small.json");
      expect(row.outcome).toBe(0.5);
    }
    // 1 局面 1 グループ: gameIdx が行ごとに一意
    const idxs = ctx.rows.map((r) => r.source.gameIdx);
    expect(new Set(idxs).size).toBe(idxs.length);
    // jushu は開局 id
    expect(suite.openings.map((o) => o.id)).toContain(
      ctx.rows[0]!.source.jushu,
    );
  });

  it("開局の手数を超える ply と minPly 未満の ply は飛ばす", () => {
    const ctx = createContext();
    const opening = {
      id: "t-1",
      positions: [
        { row: 7, col: 7 },
        { row: 6, col: 8 },
        { row: 7, col: 8 },
        { row: 7, col: 6 },
        { row: 8, col: 7 },
      ],
    };
    samplePrefix(ctx, [opening], "s.json", [3, 5, 7], { minPly: 4 });
    expect(ctx.rows.map((r) => r.source.ply)).toEqual([5]);
  });
});

describe("行数表 — 源 kind × ply 帯 × 手番", () => {
  function rowOf(
    kind: CorpusRow["source"]["kind"],
    ply: number,
    stm: CorpusRow["stm"],
  ): CorpusRow {
    return {
      key: "",
      source: { kind, file: "f", gameIdx: 0, ply, jushu: "" },
      stm,
      black: [],
      white: [],
      features: [],
      outcome: 0.5,
    };
  }

  it("tallyRow が kind/帯/手番ごとに数え、formatRowTable が合計付きで並べる", () => {
    const table = createRowTable();
    tallyRow(table, rowOf("kifu", 4, "black"));
    tallyRow(table, rowOf("kifu", 5, "white"));
    tallyRow(table, rowOf("kifu", 30, "black"));
    tallyRow(table, rowOf("book", 7, "white"));
    tallyRow(table, rowOf("prefix", 6, "black"));
    expect(table.kifu["4-6"]).toEqual({ black: 1, white: 1 });
    expect(table.kifu["26+"]).toEqual({ black: 1, white: 0 });
    expect(table.book["7"]).toEqual({ black: 0, white: 1 });
    expect(table.prefix["4-6"]).toEqual({ black: 1, white: 0 });
    const text = formatRowTable(table);
    expect(text).toContain("kifu");
    expect(text).toContain("4-6");
    expect(text).toMatch(/合計/);
    // 全体合計 5
    expect(text).toMatch(/5\s*$/m);
  });
});
