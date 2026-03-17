import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { buildLineTable } from "../lineTable/lineTable";
import { placeStonesOnBoard } from "../testUtils";
import {
  findThreatMoves,
  getCreatedOpenThreeDefenses,
  hasOpenThree,
} from "./vctHelpers";

describe("hasOpenThree - 跳び四除外", () => {
  it("跳び四の一部である連続三を活三として検出しない", () => {
    // ●●●_● 横方向: E8-F8-G8-[gap H8]-I8
    // E8-F8-G8 は両端空きの連続三だが、跳び四の一部 → 活三ではない
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" }, // E8
      { row: 7, col: 5, color: "black" }, // F8
      { row: 7, col: 6, color: "black" }, // G8
      // gap at col 7 (H8)
      { row: 7, col: 8, color: "black" }, // I8
    ]);

    expect(hasOpenThree(board, "black")).toBe(false);
  });

  it("跳び四に含まれない連続活三を検出する", () => {
    // ●●● 横方向: F8-G8-H8（両端空き、跳び四なし）
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" }, // F8
      { row: 7, col: 6, color: "black" }, // G8
      { row: 7, col: 7, color: "black" }, // H8
    ]);

    expect(hasOpenThree(board, "black")).toBe(true);
  });

  it("跳び三を検出する", () => {
    // ●●_● 横方向: H7-I7-[gap J7]-K7
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 8, col: 7, color: "black" }, // H7
      { row: 8, col: 8, color: "black" }, // I7
      // gap at col 9 (J7)
      { row: 8, col: 10, color: "black" }, // K7
    ]);

    expect(hasOpenThree(board, "black")).toBe(true);
  });
});

describe("getCreatedOpenThreeDefenses - 跳び四除外", () => {
  it("跳び四を含むラインの防御位置を返さない", () => {
    // ●●●_● 横方向: E8-F8-G8-[gap H8]-I8
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" }, // E8
      { row: 7, col: 5, color: "black" }, // F8
      { row: 7, col: 6, color: "black" }, // G8
      // gap at col 7 (H8)
      { row: 7, col: 8, color: "black" }, // I8
    ]);

    // G8 を起点として活三の防御位置を検索 → 跳び四の一部なので空
    const defenses = getCreatedOpenThreeDefenses(board, 7, 6, "black");
    expect(defenses).toHaveLength(0);
  });

  it("跳び四を含まないラインの防御位置を正しく返す", () => {
    // ●●● 縦方向: H7-H8-H9（両端空き）
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 8, col: 7, color: "black" }, // H7
      { row: 7, col: 7, color: "black" }, // H8
      { row: 6, col: 7, color: "black" }, // H9
    ]);

    // H9 を起点として活三の防御位置を検索
    const defenses = getCreatedOpenThreeDefenses(board, 6, 7, "black");
    expect(defenses.length).toBeGreaterThan(0);
    // H10(row=5) と H6(row=9) が含まれる
    expect(defenses.some((d) => d.row === 5 && d.col === 7)).toBe(true);
    expect(defenses.some((d) => d.row === 9 && d.col === 7)).toBe(true);
  });

  it("黒のウソの三（両端double-four）の防御位置を返さない", () => {
    // 横方向: F8-G8-H8 の三（両端空き）
    // E列・I列に縦の石を配置し、達四点が四四（禁手）になるようにする:
    //   E8(7,4) に伸ばすと横四(E8-F8-G8-H8) + 縦四(E6-E7-E8-E9) = 四四 → 禁手
    //   I8(7,8) に伸ばすと横四(F8-G8-H8-I8) + 縦四(I6-I7-I8-I9) = 四四 → 禁手
    // → ウソの三（有効な達四点がない）
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      // 横方向の三
      { row: 7, col: 5, color: "black" }, // F8
      { row: 7, col: 6, color: "black" }, // G8
      { row: 7, col: 7, color: "black" }, // H8
      // E列の縦石（E8への達四で四四を作る）
      { row: 9, col: 4, color: "black" }, // E6
      { row: 8, col: 4, color: "black" }, // E7
      { row: 6, col: 4, color: "black" }, // E9
      // I列の縦石（I8への達四で四四を作る）
      { row: 9, col: 8, color: "black" }, // I6
      { row: 8, col: 8, color: "black" }, // I7
      { row: 6, col: 8, color: "black" }, // I9
    ]);

    // F8(7,5) を起点: 横方向の三はウソの三 → 防御位置なし
    const defenses = getCreatedOpenThreeDefenses(board, 7, 5, "black");
    expect(defenses).toHaveLength(0);
  });
});

describe("findThreatMoves - lineTable等価性", () => {
  /** Position配列を集合として比較するヘルパー */
  function posSetKey(positions: { row: number; col: number }[]): string {
    return positions
      .map((p) => `${p.row},${p.col}`)
      .sort()
      .join("|");
  }

  it("活三がある盤面で同じ脅威手を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const lt = buildLineTable(board);
    const slow = findThreatMoves(board, "black");
    const fast = findThreatMoves(board, "black", lt);
    expect(posSetKey(fast)).toBe(posSetKey(slow));
  });

  it("四がある盤面で同じ脅威手を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const lt = buildLineTable(board);
    const slow = findThreatMoves(board, "black");
    const fast = findThreatMoves(board, "black", lt);
    expect(posSetKey(fast)).toBe(posSetKey(slow));
  });

  it("白の脅威手でも一致する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 5, col: 5, color: "black" },
      { row: 5, col: 6, color: "black" },
    ]);
    const lt = buildLineTable(board);
    const slow = findThreatMoves(board, "white");
    const fast = findThreatMoves(board, "white", lt);
    expect(posSetKey(fast)).toBe(posSetKey(slow));
  });

  it("混合盤面で両色の脅威手が一致する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "black" },
      { row: 8, col: 7, color: "black" },
      { row: 6, col: 6, color: "white" },
      { row: 6, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
    ]);
    const lt = buildLineTable(board);
    for (const color of ["black", "white"] as const) {
      const slow = findThreatMoves(board, color);
      const fast = findThreatMoves(board, color, lt);
      expect(posSetKey(fast)).toBe(posSetKey(slow));
    }
  });

  it("空盤面では脅威手なし", () => {
    const board = createEmptyBoard();
    const lt = buildLineTable(board);
    expect(findThreatMoves(board, "black", lt)).toHaveLength(0);
  });

  it("跳び四パターン（○_○○○）で一致する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" }, // E8
      // gap at col 5
      { row: 7, col: 6, color: "black" }, // G8
      { row: 7, col: 7, color: "black" }, // H8
      { row: 7, col: 8, color: "black" }, // I8
    ]);
    const lt = buildLineTable(board);
    const slow = findThreatMoves(board, "black");
    const fast = findThreatMoves(board, "black", lt);
    expect(posSetKey(fast)).toBe(posSetKey(slow));
    // col=5 (ギャップ) が含まれるはず
    expect(fast.some((p) => p.row === 7 && p.col === 5)).toBe(true);
  });

  it("斜め方向の脅威手で一致する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 5, col: 5, color: "black" },
      { row: 6, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const lt = buildLineTable(board);
    const slow = findThreatMoves(board, "black");
    const fast = findThreatMoves(board, "black", lt);
    expect(posSetKey(fast)).toBe(posSetKey(slow));
  });

  it("盤端の脅威手で一致する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 0, col: 0, color: "black" },
      { row: 0, col: 1, color: "black" },
      { row: 0, col: 2, color: "black" },
    ]);
    const lt = buildLineTable(board);
    const slow = findThreatMoves(board, "black");
    const fast = findThreatMoves(board, "black", lt);
    expect(posSetKey(fast)).toBe(posSetKey(slow));
  });

  it("跳び三パターン（○_○○）で一致する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      // gap at col 6
      { row: 7, col: 7, color: "white" },
      { row: 7, col: 8, color: "white" },
    ]);
    const lt = buildLineTable(board);
    const slow = findThreatMoves(board, "white");
    const fast = findThreatMoves(board, "white", lt);
    expect(posSetKey(fast)).toBe(posSetKey(slow));
  });
});
