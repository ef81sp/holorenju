/**
 * 脅威解析モジュールのテスト
 */

import { describe, expect, it } from "vitest";

import type { BoardState, Position } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

import { getJumpThreeDefensePositions } from "./threatAnalysis";

/**
 * 盤面に石を配置するヘルパー
 */
function placeStones(
  board: BoardState,
  stones: { row: number; col: number; color: "black" | "white" }[],
): BoardState {
  const newBoard = board.map((row) => [...row]) as BoardState;
  for (const { row, col, color } of stones) {
    newBoard[row][col] = color;
  }
  return newBoard;
}

/**
 * Position配列を比較用にソート
 */
function sortPositions(positions: Position[]): Position[] {
  return [...positions].sort((a, b) => {
    if (a.row !== b.row) {
      return a.row - b.row;
    }
    return a.col - b.col;
  });
}

describe("getJumpThreeDefensePositions", () => {
  describe("跳び三パターン: ・●●・●・", () => {
    it("防御位置（両端と中間の空き）を返す", () => {
      const board = placeStones(createEmptyBoard(), [
        // col: 3 は空き (防御点)
        { row: 7, col: 4, color: "black" },
        { row: 7, col: 5, color: "black" },
        // col: 6 は空き (防御点)
        { row: 7, col: 7, color: "black" },
        // col: 8 は空き (防御点)
      ]);

      const result = getJumpThreeDefensePositions(board, 7, 7, 0, 1, "black");
      const sorted = sortPositions(result);

      expect(sorted).toContainEqual({ row: 7, col: 3 });
      expect(sorted).toContainEqual({ row: 7, col: 6 });
      expect(sorted).toContainEqual({ row: 7, col: 8 });
    });
  });

  describe("跳び三パターン: ・●・●●・", () => {
    it("防御位置を返す", () => {
      const board = placeStones(createEmptyBoard(), [
        // col: 3 は空き (防御点)
        { row: 7, col: 4, color: "black" },
        // col: 5 は空き (防御点)
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
        // col: 8 は空き (防御点)
      ]);

      const result = getJumpThreeDefensePositions(board, 7, 7, 0, 1, "black");
      const sorted = sortPositions(result);

      expect(sorted).toContainEqual({ row: 7, col: 3 });
      expect(sorted).toContainEqual({ row: 7, col: 5 });
      expect(sorted).toContainEqual({ row: 7, col: 8 });
    });
  });

  describe("エッジケース", () => {
    it("跳び三パターンがない場合は空配列を返す", () => {
      const board = placeStones(createEmptyBoard(), [
        { row: 7, col: 4, color: "black" },
        { row: 7, col: 5, color: "black" },
      ]);

      const result = getJumpThreeDefensePositions(board, 7, 5, 0, 1, "black");
      expect(result).toEqual([]);
    });
  });
});
