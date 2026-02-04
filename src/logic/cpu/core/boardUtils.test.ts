/**
 * CPU盤面ユーティリティ関数のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { placeStonesOnBoard } from "../testUtils";
import {
  applyMove,
  countStones,
  getOppositeColor,
  selectRandom,
} from "./boardUtils";

describe("getOppositeColor", () => {
  it("黒の反対は白", () => {
    expect(getOppositeColor("black")).toBe("white");
  });

  it("白の反対は黒", () => {
    expect(getOppositeColor("white")).toBe("black");
  });
});

describe("countStones", () => {
  it("空の盤面は0", () => {
    const board = createEmptyBoard();
    expect(countStones(board)).toBe(0);
  });

  it("石を1つ配置すると1", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);
    expect(countStones(board)).toBe(1);
  });

  it("石を複数配置すると正しい数", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
      { row: 6, col: 7, color: "black" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 7, color: "black" },
    ]);
    expect(countStones(board)).toBe(5);
  });
});

describe("applyMove", () => {
  it("元の盤面を変更しない", () => {
    const board = createEmptyBoard();
    const newBoard = applyMove(board, { row: 7, col: 7 }, "black");

    expect(board[7]?.[7]).toBeNull();
    expect(newBoard[7]?.[7]).toBe("black");
  });

  it("指定位置に石を配置した新しい盤面を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const newBoard = applyMove(board, { row: 7, col: 8 }, "white");

    expect(newBoard[7]?.[7]).toBe("black");
    expect(newBoard[7]?.[8]).toBe("white");
  });
});

describe("selectRandom", () => {
  it("空配列はundefinedを返す", () => {
    expect(selectRandom([])).toBeUndefined();
  });

  it("1要素の配列はその要素を返す", () => {
    expect(selectRandom([42])).toBe(42);
  });

  it("固定ランダム関数で予測可能な結果", () => {
    const array = [1, 2, 3, 4, 5];
    // 常に0を返すランダム関数 → 最初の要素
    expect(selectRandom(array, () => 0)).toBe(1);
    // 常に0.99を返すランダム関数 → 最後の要素
    expect(selectRandom(array, () => 0.99)).toBe(5);
    // 常に0.5を返すランダム関数 → 中央の要素
    expect(selectRandom(array, () => 0.5)).toBe(3);
  });
});
