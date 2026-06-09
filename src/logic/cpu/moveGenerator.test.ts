/**
 * 候補手の近傍判定のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { isNearExistingStone } from "./moveGenerator";
import { placeStonesOnBoard } from "./testUtils";

describe("isNearExistingStone", () => {
  it("石の周囲2マスはtrueを返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    // 隣接マス
    expect(isNearExistingStone(board, 7, 6)).toBe(true);
    expect(isNearExistingStone(board, 7, 8)).toBe(true);
    expect(isNearExistingStone(board, 6, 7)).toBe(true);
    expect(isNearExistingStone(board, 8, 7)).toBe(true);

    // 斜め隣接マス
    expect(isNearExistingStone(board, 6, 6)).toBe(true);
    expect(isNearExistingStone(board, 8, 8)).toBe(true);

    // 2マス離れた位置
    expect(isNearExistingStone(board, 7, 5)).toBe(true);
    expect(isNearExistingStone(board, 7, 9)).toBe(true);
    expect(isNearExistingStone(board, 5, 7)).toBe(true);
    expect(isNearExistingStone(board, 9, 7)).toBe(true);
  });

  it("石の周囲3マス以上はfalseを返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    // 3マス離れた位置
    expect(isNearExistingStone(board, 7, 4)).toBe(false);
    expect(isNearExistingStone(board, 7, 10)).toBe(false);
    expect(isNearExistingStone(board, 4, 7)).toBe(false);
    expect(isNearExistingStone(board, 10, 7)).toBe(false);
  });

  it("空の盤面はすべてfalse", () => {
    const board = createEmptyBoard();

    expect(isNearExistingStone(board, 7, 7)).toBe(false);
    expect(isNearExistingStone(board, 0, 0)).toBe(false);
    expect(isNearExistingStone(board, 14, 14)).toBe(false);
  });
});
