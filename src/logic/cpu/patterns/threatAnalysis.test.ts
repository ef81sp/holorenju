/**
 * 脅威解析モジュールのテスト
 */

import { describe, expect, it } from "vitest";

import type { BoardState, Position } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

import {
  findJumpGapPosition,
  getJumpThreeDefensePositions,
} from "./threatAnalysis";

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

describe("findJumpGapPosition", () => {
  describe("跳び四パターン1: ●●●・●", () => {
    it("横方向の跳び四の空き位置を検出する", () => {
      const board = placeStones(createEmptyBoard(), [
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 4, color: "black" },
        { row: 7, col: 5, color: "black" },
        // col: 6 は空き
        { row: 7, col: 7, color: "black" },
      ]);

      // col: 7 の石を起点に検出
      const result = findJumpGapPosition(board, 7, 7, 0, 1, "black");
      expect(result).toEqual({ row: 7, col: 6 });
    });

    it("縦方向の跳び四の空き位置を検出する", () => {
      const board = placeStones(createEmptyBoard(), [
        { row: 3, col: 7, color: "white" },
        { row: 4, col: 7, color: "white" },
        { row: 5, col: 7, color: "white" },
        // row: 6 は空き
        { row: 7, col: 7, color: "white" },
      ]);

      const result = findJumpGapPosition(board, 7, 7, 1, 0, "white");
      expect(result).toEqual({ row: 6, col: 7 });
    });
  });

  describe("跳び四パターン2: ●●・●●", () => {
    it("中央の空き位置を検出する", () => {
      const board = placeStones(createEmptyBoard(), [
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 4, color: "black" },
        // col: 5 は空き
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
      ]);

      const result = findJumpGapPosition(board, 7, 7, 0, 1, "black");
      expect(result).toEqual({ row: 7, col: 5 });
    });
  });

  describe("跳び四パターン3: ●・●●●", () => {
    it("2番目の空き位置を検出する", () => {
      const board = placeStones(createEmptyBoard(), [
        { row: 7, col: 3, color: "black" },
        // col: 4 は空き
        { row: 7, col: 5, color: "black" },
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
      ]);

      const result = findJumpGapPosition(board, 7, 7, 0, 1, "black");
      expect(result).toEqual({ row: 7, col: 4 });
    });
  });

  describe("斜め方向", () => {
    it("右下斜めの跳び四を検出する", () => {
      const board = placeStones(createEmptyBoard(), [
        { row: 3, col: 3, color: "black" },
        { row: 4, col: 4, color: "black" },
        { row: 5, col: 5, color: "black" },
        // (6, 6) は空き
        { row: 7, col: 7, color: "black" },
      ]);

      const result = findJumpGapPosition(board, 7, 7, 1, 1, "black");
      expect(result).toEqual({ row: 6, col: 6 });
    });
  });

  describe("エッジケース", () => {
    it("跳び四パターンがない場合はnullを返す", () => {
      const board = placeStones(createEmptyBoard(), [
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 4, color: "black" },
        { row: 7, col: 7, color: "black" },
      ]);

      const result = findJumpGapPosition(board, 7, 7, 0, 1, "black");
      expect(result).toBeNull();
    });

    it("盤端では部分的なパターンのみ検出", () => {
      const board = placeStones(createEmptyBoard(), [
        { row: 0, col: 0, color: "black" },
        // (0, 1) は空き
        { row: 0, col: 2, color: "black" },
        { row: 0, col: 3, color: "black" },
        { row: 0, col: 4, color: "black" },
      ]);

      const result = findJumpGapPosition(board, 0, 4, 0, 1, "black");
      expect(result).toEqual({ row: 0, col: 1 });
    });
  });
});

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
