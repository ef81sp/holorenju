/**
 * openingSuite.ts（開局スイート生成の純粋部分）のテスト。
 * bench-precision-2026-09-04.md §2.2 手順 2〜3 を固定する。
 */
import { describe, expect, it } from "vitest";

import { boardToString } from "@/logic/boardSymmetry";
import { getJushuPositions } from "@/logic/cpu/opening";
import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";

import {
  assertRawMeta,
  boardToPseudoMoves,
  buildCandidateOrder,
  classifyPlyCheck,
  classifyRaw,
  isHorizonFlip,
  detectRootJushu,
  parentKey,
  parseBoardKey,
  parsePlyCheckLines,
  parseRawLines,
  partitionByRaw,
  type PlyCheckResult,
  type PlyRecord,
  type RawEvaluation,
  selectOpenings,
  selectSevenStoneWhiteKeys,
  type SignedCandidate,
  stratifyBySign,
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

describe("classifyRaw", () => {
  const cand: SuiteCandidate = { key: "k", parent: "P", root: null };
  it("|score| > しきい値なら score、それ以外は生評価の勝ち判定", () => {
    expect(
      classifyRaw(
        { score: 400, bestMove: "H9", reject: null, elapsedMs: 1 },
        cand,
        300,
      ),
    ).toBe("score");
    expect(
      classifyRaw(
        { score: 10, bestMove: "H9", reject: "whiteWin", elapsedMs: 1 },
        cand,
        300,
      ),
    ).toBe("whiteWin");
    expect(
      classifyRaw(
        { score: -300, bestMove: "H9", reject: null, elapsedMs: 1 },
        cand,
        300,
      ),
    ).toBeNull();
  });
});

describe("parseRawLines / assertRawMeta", () => {
  const rec = (key: string, nodes = 100000, depth = 7): string =>
    JSON.stringify({
      key,
      parent: "P",
      root: null,
      score: 0,
      bestMove: "H9",
      reject: null,
      elapsedMs: 1,
      scoreAbsMax: 1000,
      nodes,
      depth,
    });

  it("JSONL を results と meta（nodes/depth/scoreAbsMax）に分ける。空行は無視", () => {
    const { results, meta } = parseRawLines(`${rec("a")}\n\n${rec("b")}\n`);
    expect([...results.keys()]).toEqual(["a", "b"]);
    expect(meta).toEqual({ nodes: 100000, depth: 7, scoreAbsMax: 1000 });
  });

  it("空入力なら meta は null", () => {
    expect(parseRawLines("").meta).toBeNull();
  });

  it("行ごとに nodes/depth が食い違っていれば例外", () => {
    expect(() => parseRawLines(`${rec("a")}\n${rec("b", 50000)}`)).toThrow(
      /nodes\/depth/,
    );
  });

  it("assertRawMeta は CLI 指定と raw の nodes/depth 不一致で例外", () => {
    const meta = { nodes: 100000, depth: 7, scoreAbsMax: 1000 };
    expect(() =>
      assertRawMeta(meta, { nodes: 100000, depth: 7 }),
    ).not.toThrow();
    expect(() => assertRawMeta(meta, { nodes: 200000, depth: 7 })).toThrow(
      /--nodes/,
    );
    expect(() => assertRawMeta(meta, { nodes: 100000, depth: 5 })).toThrow(
      /--depth/,
    );
  });
});

describe("classifyPlyCheck", () => {
  const ply = (score: number): PlyRecord => ({
    move: "H9",
    score,
    completedDepth: 7,
  });
  const opts = { plyScoreAbsMax: 700, pliesRequired: 4 };

  it("全 ply が |score| <= しきい値で終局なしなら通過", () => {
    const r: PlyCheckResult = {
      plies: [ply(100), ply(-300), ply(699), ply(-700)],
      terminal: null,
      elapsedMs: 1,
    };
    expect(classifyPlyCheck(r, opts)).toEqual({ reject: null, atPly: null });
  });

  it("途中終局（五連/禁手/着手なし）は terminal、atPly は終局した手数", () => {
    const r: PlyCheckResult = {
      plies: [ply(100), ply(3000)],
      terminal: "five",
      elapsedMs: 1,
    };
    expect(classifyPlyCheck(r, opts)).toEqual({ reject: "terminal", atPly: 2 });
  });

  it("最初にしきい値を超えた ply を報告する（1 始まり）", () => {
    const r: PlyCheckResult = {
      plies: [ply(100), ply(-200), ply(701), ply(5000)],
      terminal: null,
      elapsedMs: 1,
    };
    expect(classifyPlyCheck(r, opts)).toEqual({ reject: "plyScore", atPly: 3 });
  });

  it("ply が足りなければ incomplete", () => {
    const r: PlyCheckResult = { plies: [ply(0)], terminal: null, elapsedMs: 1 };
    expect(classifyPlyCheck(r, opts)).toEqual({
      reject: "incomplete",
      atPly: 1,
    });
  });
});

describe("isHorizonFlip", () => {
  const ply = (score: number): PlyRecord => ({
    move: "H9",
    score,
    completedDepth: 7,
  });
  const opts = { rootScoreAbsMax: 500, flipScoreAbsMin: 2000 };
  it("根が均衡なのに 4 手以内に |score| > 2000 になれば flip", () => {
    expect(isHorizonFlip(120, [ply(300), ply(-2500)], opts)).toBe(true);
    expect(isHorizonFlip(120, [ply(300), ply(2000)], opts)).toBe(false);
  });
  it("根が均衡でなければ flip とみなさない", () => {
    expect(isHorizonFlip(800, [ply(3000)], opts)).toBe(false);
  });
});

describe("parsePlyCheckLines", () => {
  const rec = (key: string, plies = 4, nodes = 100000): string =>
    JSON.stringify({
      key,
      rootScore: 10,
      plies: [{ move: "H9", score: 1, completedDepth: 7 }],
      terminal: null,
      elapsedMs: 5,
      pliesRequested: plies,
      nodes,
      depth: 7,
      timeLimitMs: 10000,
    });
  it("results と meta に分ける。空行無視", () => {
    const { results, meta } = parsePlyCheckLines(`${rec("a")}\n\n${rec("b")}`);
    expect([...results.keys()]).toEqual(["a", "b"]);
    expect(results.get("a")?.plies).toHaveLength(1);
    expect(meta).toEqual({
      pliesRequested: 4,
      nodes: 100000,
      depth: 7,
      timeLimitMs: 10000,
    });
  });
  it("設定が行ごとに食い違えば例外", () => {
    expect(() => parsePlyCheckLines(`${rec("a")}\n${rec("b", 6)}`)).toThrow(
      /設定/,
    );
  });
});

describe("stratifyBySign", () => {
  const item = (key: string, score: number): SignedCandidate => ({
    candidate: { key, parent: key, root: null },
    rootScore: score,
  });

  it("負側（黒有利）を比率以上含め、順序は交互に混ぜる", () => {
    const ordered = [
      ...Array.from({ length: 10 }, (_, i) => item(`p${i}`, 100 + i)),
      ...Array.from({ length: 10 }, (_, i) => item(`n${i}`, -100 - i)),
    ];
    const r = stratifyBySign(ordered, { target: 10, negativeRatioMin: 0.4 });
    expect(r.picked).toHaveLength(10);
    expect(r.negativeCount).toBe(4);
    expect(r.nonNegativeCount).toBe(6);
    // 先頭 5 件に負側が 2 件含まれる（偏らずに混ざる）
    expect(r.picked.slice(0, 5).filter((x) => x.rootScore < 0)).toHaveLength(2);
  });

  it("負側が不足なら達成できる比率で、非負側で target まで埋める", () => {
    const ordered = [
      ...Array.from({ length: 20 }, (_, i) => item(`p${i}`, i)), // 0 は非負
      item("n0", -5),
    ];
    const r = stratifyBySign(ordered, { target: 10, negativeRatioMin: 0.4 });
    expect(r.picked).toHaveLength(10);
    expect(r.negativeCount).toBe(1);
    expect(r.nonNegativeCount).toBe(9);
  });

  it("非負側が不足なら負側を比率以上に使う。全体が足りなければ届く件数", () => {
    const ordered = [
      item("p0", 1),
      ...Array.from({ length: 10 }, (_, i) => item(`n${i}`, -1 - i)),
    ];
    const r = stratifyBySign(ordered, { target: 8, negativeRatioMin: 0.4 });
    expect(r.picked).toHaveLength(8);
    expect(r.negativeCount).toBe(7);
    const small = stratifyBySign(ordered.slice(0, 3), {
      target: 8,
      negativeRatioMin: 0.4,
    });
    expect(small.picked).toHaveLength(3);
  });

  it("各側の中では入力順（層化順）を保つ", () => {
    const ordered = [
      item("n0", -1),
      item("p0", 1),
      item("n1", -2),
      item("p1", 2),
    ];
    const r = stratifyBySign(ordered, { target: 4, negativeRatioMin: 0.5 });
    const negs = r.picked
      .filter((x) => x.rootScore < 0)
      .map((x) => x.candidate.key);
    expect(negs).toEqual(["n0", "n1"]);
  });
});
