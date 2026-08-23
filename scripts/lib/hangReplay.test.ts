import { describe, expect, it } from "vitest";

import {
  type ReplayMove,
  colorOfMoveIndex,
  deriveGameSeed,
  deriveMoveSeed,
  nonOpeningOrdinalOf,
  planGameReplay,
  sideColor,
} from "./hangReplay.ts";
import { mixSeed } from "./mulberry32.ts";

/** 開局3手 + 非オープニング手 n 手の棋譜を作る */
function makeMoves(nonOpeningCount: number): ReplayMove[] {
  const moves: ReplayMove[] = [
    { row: 7, col: 7, isOpening: true },
    { row: 6, col: 8, isOpening: true },
    { row: 9, col: 7, isOpening: true },
  ];
  for (let i = 0; i < nonOpeningCount; i++) {
    moves.push({ row: i, col: i, isOpening: false });
  }
  return moves;
}

describe("colorOfMoveIndex", () => {
  it("開局手を含め黒→白→黒…と交互", () => {
    expect(colorOfMoveIndex(0)).toBe("black");
    expect(colorOfMoveIndex(1)).toBe("white");
    expect(colorOfMoveIndex(2)).toBe("black");
    expect(colorOfMoveIndex(3)).toBe("white");
  });
});

describe("sideColor", () => {
  it("A側は isABlack のとき黒", () => {
    expect(sideColor("A", true)).toBe("black");
  });
  it("A側は isABlack が false なら白", () => {
    expect(sideColor("A", false)).toBe("white");
  });
  it("B側は isABlack のとき白", () => {
    expect(sideColor("B", true)).toBe("white");
  });
  it("B側は isABlack が false なら黒", () => {
    expect(sideColor("B", false)).toBe("black");
  });
});

describe("seed 導出", () => {
  it("baseSeed 未指定なら gameSeed も未指定", () => {
    expect(deriveGameSeed(undefined, 3)).toBeUndefined();
  });

  it("gameSeed は mixSeed(baseSeed, gameIdx)", () => {
    expect(deriveGameSeed(12345, 3)).toBe(mixSeed(12345, 3));
  });

  it("gameSeed 未指定なら moveSeed も未指定", () => {
    expect(deriveMoveSeed(undefined, 1)).toBeUndefined();
  });

  it("moveSeed は mixSeed(gameSeed, nonOpeningOrdinal)", () => {
    expect(deriveMoveSeed(999, 4)).toBe(mixSeed(999, 4));
  });

  it("局が違えば seed も違う（局間で棋譜が同一にならない）", () => {
    expect(deriveGameSeed(1, 0)).not.toBe(deriveGameSeed(1, 1));
  });
});

describe("planGameReplay", () => {
  it("ハング側の非オープニング手だけを要求する（A黒なら偶数 index）", () => {
    const plan = planGameReplay({
      moves: makeMoves(4),
      side: "A",
      isABlack: true,
    });
    expect(plan.color).toBe("black");
    // index 0,2 は開局手（黒）なので除外。黒の非オープニングは index 4, 6
    expect(plan.requests.map((r) => r.moveIndex)).toEqual([4, 6]);
  });

  it("A白なら白番だけを要求する", () => {
    const plan = planGameReplay({
      moves: makeMoves(4),
      side: "A",
      isABlack: false,
    });
    expect(plan.color).toBe("white");
    expect(plan.requests.map((r) => r.moveIndex)).toEqual([3, 5]);
  });

  it("nonOpeningOrdinal は相手の手も含めて通し番号（bench と同じ規則）", () => {
    const plan = planGameReplay({
      moves: makeMoves(4),
      side: "A",
      isABlack: false,
    });
    // index 3 が 1 手目、index 5 が 3 手目の非オープニング要求
    expect(plan.requests.map((r) => r.nonOpeningOrdinal)).toEqual([1, 3]);
  });

  it("moveSeed は gameSeed と nonOpeningOrdinal から導出される", () => {
    const plan = planGameReplay({
      moves: makeMoves(4),
      side: "A",
      isABlack: false,
      gameSeed: 777,
    });
    expect(plan.requests[0]?.moveSeed).toBe(mixSeed(777, 1));
    expect(plan.requests[1]?.moveSeed).toBe(mixSeed(777, 3));
  });

  it("gameSeed 未指定なら moveSeed も未指定", () => {
    const plan = planGameReplay({
      moves: makeMoves(2),
      side: "B",
      isABlack: true,
    });
    expect(plan.requests.every((r) => r.moveSeed === undefined)).toBe(true);
  });

  it("開局手しかなければ要求は 0 件", () => {
    const plan = planGameReplay({
      moves: makeMoves(0),
      side: "A",
      isABlack: true,
    });
    expect(plan.requests).toEqual([]);
  });

  it("moveNumber は 1-based", () => {
    const plan = planGameReplay({
      moves: makeMoves(2),
      side: "A",
      isABlack: false,
    });
    expect(plan.requests[0]?.moveNumber).toBe(4);
  });
});

describe("nonOpeningOrdinalOf", () => {
  it("開局3手のあと 4 手目は 1 番目の非オープニング要求", () => {
    expect(nonOpeningOrdinalOf(makeMoves(4), 4)).toBe(1);
  });

  it("6 手目は 3 番目", () => {
    expect(nonOpeningOrdinalOf(makeMoves(4), 6)).toBe(3);
  });

  it("記録された手数 + 1（次に打つ手）でも数えられる", () => {
    const moves = makeMoves(2); // 5手ぶん
    expect(nonOpeningOrdinalOf(moves, moves.length + 1)).toBe(3);
  });
});
