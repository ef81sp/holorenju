/**
 * openingSuite.ts（開局スイート生成の純粋部分）のテスト。
 * bench-precision-2026-09-04.md §2.2 手順 2〜3 を固定する。
 */
import { describe, expect, it } from "vitest";

import { boardToString } from "@/logic/boardSymmetry";
import { getJushuPositions } from "@/logic/cpu/opening";
import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";

import {
  boardToPseudoMoves,
  buildCandidateOrder,
  detectRootJushu,
  parentKey,
  parseBoardKey,
  partitionByRaw,
  type RawEvaluation,
  selectOpenings,
  selectSevenStoneWhiteKeys,
  type SuiteCandidate,
} from "./openingSuite.ts";

/** 7 石（黒 4・白 3）の実戦的な棋譜 */
const RECORD_7 = "H8 I9 I8 G8 H7 G6 I7";

function keyOf(record: string, side: "black" | "white" = "white"): string {
  const { board } = createBoardFromRecord(record);
  return `${boardToString(board)}|${side}`;
}

describe("parseBoardKey", () => {
  it("boardToString の逆変換になっている（ラウンドトリップ）", () => {
    const key = keyOf(RECORD_7);
    const { board, sideToMove } = parseBoardKey(key);
    expect(sideToMove).toBe("white");
    expect(`${boardToString(board)}|white`).toBe(key);
  });

  it("row 0 が 15 段目（上端）で、gameRecordParser の座標系と一致する", () => {
    // H8 だけの盤面。H8 = col 7, row 15-8 = 7
    const { board } = parseBoardKey(keyOf("H8", "white"));
    expect(board[7]?.[7]).toBe("black");
    // A15 は row 0, col 0
    const { board: b2 } = parseBoardKey(keyOf("A15", "white"));
    expect(b2[0]?.[0]).toBe("black");
    expect(boardToString(b2).startsWith("B")).toBe(true);
  });

  it("225 文字でない・手番が不正なキーは例外", () => {
    expect(() => parseBoardKey("....|white")).toThrow();
    expect(() => parseBoardKey(`${".".repeat(225)}|red`)).toThrow();
    expect(() => parseBoardKey(".".repeat(225))).toThrow();
  });
});

describe("selectSevenStoneWhiteKeys", () => {
  it("7 石（黒 4・白 3）かつ白番のキーだけを残す", () => {
    const k7 = keyOf(RECORD_7);
    const k5 = keyOf("H8 I9 I8 G8 H7");
    const k7black = keyOf(`${RECORD_7} J8`, "black"); // 8 石
    const k7wrong = `${boardToString(createBoardFromRecord("H8 I9 I8 G8 H7 G6 I7").board)}|black`;
    expect(selectSevenStoneWhiteKeys([k5, k7, k7black, k7wrong])).toEqual([k7]);
  });
});

describe("boardToPseudoMoves", () => {
  it("黒 4・白 3 を黒から交互に並べ、再生すると同じ盤面になる", () => {
    const { board } = parseBoardKey(keyOf(RECORD_7));
    const moves = boardToPseudoMoves(board);
    expect(moves).toHaveLength(7);
    const record = moves.map(formatMove).join(" ");
    const { board: replayed, nextColor } = createBoardFromRecord(record);
    expect(nextColor).toBe("white");
    expect(boardToString(replayed)).toBe(boardToString(board));
  });

  it("石数が黒 4・白 3 でなければ例外", () => {
    const { board } = parseBoardKey(keyOf("H8 I9 I8"));
    expect(() => boardToPseudoMoves(board)).toThrow();
  });

  it("決定的（同じ盤面からは同じ手順）", () => {
    const { board } = parseBoardKey(keyOf(RECORD_7));
    expect(boardToPseudoMoves(board)).toEqual(boardToPseudoMoves(board));
  });
});

describe("parentKey", () => {
  it("白 3 石の表記をソートして連結する", () => {
    const { board } = parseBoardKey(keyOf(RECORD_7));
    // 白: I9, G8, G6 → ソート（文字列順）
    expect(parentKey(board)).toBe("G6 G8 I9");
  });

  it("白石の配置が同じなら黒石が違っても同じ親", () => {
    const a = parseBoardKey(keyOf("H8 I9 I8 G8 H7 G6 I7")).board;
    const b = parseBoardKey(keyOf("H8 I9 I8 G8 H7 G6 J7")).board;
    expect(parentKey(a)).toBe(parentKey(b));
  });
});

describe("detectRootJushu", () => {
  it("珠型 3 石が部分集合なら珠型名を返す（基準方向）", () => {
    const pos = getJushuPositions("花月", true);
    expect(pos).not.toBeNull();
    const [b1, w2, b3] = pos!;
    const record = [b1, w2, b3].map(formatMove).join(" ");
    const { board } = createBoardFromRecord(`${record} A1 B1 A2 B2`);
    expect(detectRootJushu(board)).toBe("花月");
  });

  it("D4 変換された配置でも珠型名を返す", () => {
    // 花月（直接打ち: 白が天元の下）を 90 度回した形（白が天元の左右）
    const pos = getJushuPositions("花月", false);
    expect(pos).not.toBeNull();
    // fixedDirection=false はランダム方向だが、いずれの方向でも花月と判定されるべき
    const [b1, w2, b3] = pos!;
    const record = [b1, w2, b3].map(formatMove).join(" ");
    const { board } = createBoardFromRecord(`${record} A1 B1 A2 B2`);
    expect(detectRootJushu(board)).toBe("花月");
  });

  it("天元に黒石が無ければ null", () => {
    const { board } = createBoardFromRecord("A1 B1 A2 B2 A3 B3 A4");
    expect(detectRootJushu(board)).toBeNull();
  });
});

describe("buildCandidateOrder", () => {
  function cand(
    id: string,
    parent: string,
    root: string | null,
  ): SuiteCandidate {
    return { key: id, parent, root };
  }

  it("親ごと上限 cap 件に切り詰め、親をラウンドロビンで回す", () => {
    const items = [
      cand("a1", "A", "r"),
      cand("a2", "A", "r"),
      cand("a3", "A", "r"),
      cand("a4", "A", "r"),
      cand("b1", "B", "r"),
      cand("c1", "C", "r"),
      cand("c2", "C", "r"),
    ];
    const order = buildCandidateOrder(items, { seed: 1, parentCap: 2 });
    expect(order).toHaveLength(5);
    const parents = order.map((c) => c.parent);
    // 先頭 3 件は 3 親が 1 件ずつ、その後 A と C の 2 件目
    expect(new Set(parents.slice(0, 3)).size).toBe(3);
    expect(parents.slice(3).sort()).toEqual(["A", "C"]);
    // 各親の件数
    expect(parents.filter((p) => p === "A")).toHaveLength(2);
  });

  it("root が複数あるときは root もラウンドロビンで回す", () => {
    const items = [
      cand("x1", "P1", "R1"),
      cand("x2", "P2", "R1"),
      cand("x3", "P3", "R1"),
      cand("y1", "Q1", "R2"),
      cand("z1", "S1", null),
    ];
    const order = buildCandidateOrder(items, { seed: 7, parentCap: 3 });
    expect(order).toHaveLength(5);
    // 先頭 3 件で 3 つの root（R1, R2, null）が全て出る
    expect(new Set(order.slice(0, 3).map((c) => c.root)).size).toBe(3);
  });

  it("同じ seed なら同じ順序、異なる seed なら（概ね）異なる順序", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      cand(`k${i}`, `P${i % 5}`, `R${i % 3}`),
    );
    const o1 = buildCandidateOrder(items, { seed: 3, parentCap: 3 });
    const o2 = buildCandidateOrder(items, { seed: 3, parentCap: 3 });
    const o3 = buildCandidateOrder(items, { seed: 4, parentCap: 3 });
    expect(o1.map((c) => c.key)).toEqual(o2.map((c) => c.key));
    expect(o1.map((c) => c.key)).not.toEqual(o3.map((c) => c.key));
    expect(o1).toHaveLength(15); // 5 親 × cap 3
  });

  it("入力配列を変更しない", () => {
    const items = [cand("a", "A", null), cand("b", "B", null)];
    const copy = [...items];
    buildCandidateOrder(items, { seed: 1, parentCap: 1 });
    expect(items).toEqual(copy);
  });
});

describe("selectOpenings", () => {
  function cand(id: string, parent: string): SuiteCandidate {
    return { key: id, parent, root: null };
  }
  const raw = (
    score: number,
    reject: RawEvaluation["reject"] = null,
  ): RawEvaluation => ({ score, bestMove: "H9", reject, elapsedMs: 1 });

  it("候補順に走査し、しきい値と勝ち判定で採否を決め、target 件で止める", () => {
    const order = [
      cand("a", "A"),
      cand("b", "B"),
      cand("c", "C"),
      cand("d", "D"),
    ];
    const results = new Map<string, RawEvaluation>([
      ["a", raw(-50)],
      ["b", raw(500)], // 生評価では通っていてもしきい値 300 で落ちる
      ["c", raw(10, "whiteWin")],
      ["d", raw(0)],
    ]);
    const sel = selectOpenings(order, results, { scoreAbsMax: 300, target: 2 });
    expect(sel.evaluated.map((e) => [e.candidate.key, e.reject])).toEqual([
      ["a", null],
      ["b", "score"],
      ["c", "whiteWin"],
      ["d", null],
    ]);
    expect(sel.accepted.map((e) => e.candidate.key)).toEqual(["a", "d"]);
  });

  it("target に達したら以降の候補は評価済みに含めない", () => {
    const order = [cand("a", "A"), cand("b", "B")];
    const results = new Map([
      ["a", raw(0)],
      ["b", raw(0)],
    ]);
    const sel = selectOpenings(order, results, { scoreAbsMax: 300, target: 1 });
    expect(sel.evaluated).toHaveLength(1);
  });

  it("生評価が無い候補、または生評価のしきい値で落ちていて再判定できない候補は例外", () => {
    const order = [cand("a", "A")];
    expect(() =>
      selectOpenings(order, new Map(), { scoreAbsMax: 300, target: 1 }),
    ).toThrow(/未評価/);
    const results = new Map([["a", raw(100, "score")]]);
    expect(() =>
      selectOpenings(order, results, { scoreAbsMax: 300, target: 1 }),
    ).toThrow(/再判定/);
  });
});

describe("partitionByRaw", () => {
  const raw = (
    score: number,
    reject: RawEvaluation["reject"] = null,
  ): RawEvaluation => ({ score, bestMove: "H9", reject, elapsedMs: 1 });

  it("しきい値と勝ち判定で全候補を分類し、通過した候補を入力順で返す", () => {
    const cands: SuiteCandidate[] = [
      { key: "a", parent: "A", root: null },
      { key: "b", parent: "B", root: null },
      { key: "c", parent: "C", root: null },
      { key: "d", parent: "D", root: null },
    ];
    const results = new Map<string, RawEvaluation>([
      ["a", raw(-50)],
      ["b", raw(500)],
      ["c", raw(10, "blackWin")],
      ["d", raw(0)],
    ]);
    const { eligible, counts } = partitionByRaw(cands, results, 300);
    expect(eligible.map((c) => c.key)).toEqual(["a", "d"]);
    expect(counts).toEqual({ score: 1, whiteWin: 0, blackWin: 1, accepted: 2 });
  });

  it("生評価が無い候補があれば例外", () => {
    expect(() =>
      partitionByRaw([{ key: "x", parent: "X", root: null }], new Map(), 300),
    ).toThrow(/未評価/);
  });
});
