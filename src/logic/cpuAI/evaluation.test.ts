/**
 * 盤面評価関数のテスト
 */

import { describe, expect, it } from "vitest";

import type { BoardState, StoneColor } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

import { evaluateBoard, evaluatePosition, PATTERN_SCORES } from "./evaluation";

/**
 * テスト用の盤面にパターンを配置するヘルパー
 */
function placeStonesOnBoard(
  board: BoardState,
  stones: { row: number; col: number; color: StoneColor }[],
): void {
  for (const stone of stones) {
    const row = board[stone.row];
    if (row) {
      row[stone.col] = stone.color;
    }
  }
}

describe("PATTERN_SCORES", () => {
  it("スコア定数が正しく定義されている", () => {
    expect(PATTERN_SCORES.FIVE).toBe(100000);
    expect(PATTERN_SCORES.OPEN_FOUR).toBe(5000);
    expect(PATTERN_SCORES.FOUR).toBe(500);
    expect(PATTERN_SCORES.OPEN_THREE).toBe(300);
    expect(PATTERN_SCORES.THREE).toBe(50);
    expect(PATTERN_SCORES.OPEN_TWO).toBe(10);
    expect(PATTERN_SCORES.CENTER_BONUS).toBe(5);
    expect(PATTERN_SCORES.FORBIDDEN_TRAP).toBe(100);
  });
});

describe("evaluatePosition", () => {
  it("空の盤面の中央への着手は中央ボーナスを得る", () => {
    const board = createEmptyBoard();
    const score = evaluatePosition(board, 7, 7, "black");
    expect(score).toBeGreaterThan(0);
  });

  it("隅への着手は中央ボーナスを得られない", () => {
    const board = createEmptyBoard();
    const centerScore = evaluatePosition(board, 7, 7, "black");
    const cornerScore = evaluatePosition(board, 0, 0, "black");
    expect(centerScore).toBeGreaterThan(cornerScore);
  });

  it("五連形成は最高スコアを得る", () => {
    const board = createEmptyBoard();
    // 黒石を4つ並べる
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 5つ目を置く位置を評価
    const score = evaluatePosition(board, 7, 7, "black");
    expect(score).toBe(PATTERN_SCORES.FIVE);
  });

  it("活四形成は高スコアを得る", () => {
    const board = createEmptyBoard();
    // 黒石を3つ並べる（両端が空いている）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 4つ目を置く位置を評価（両端が空いている）
    const score = evaluatePosition(board, 7, 7, "black");
    expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.OPEN_FOUR);
  });

  it("活三形成は中程度のスコアを得る", () => {
    const board = createEmptyBoard();
    // 黒石を2つ並べる（両端が空いている）
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 3つ目を置く位置を評価
    const score = evaluatePosition(board, 7, 7, "black");
    expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.OPEN_THREE);
  });
});

describe("evaluateBoard", () => {
  it("空の盤面は0に近いスコア", () => {
    const board = createEmptyBoard();
    const score = evaluateBoard(board, "black");
    expect(score).toBe(0);
  });

  it("黒の視点で黒が有利な盤面は正のスコア", () => {
    const board = createEmptyBoard();
    // 黒の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const score = evaluateBoard(board, "black");
    expect(score).toBeGreaterThan(0);
  });

  it("黒の視点で白が有利な盤面は負のスコア", () => {
    const board = createEmptyBoard();
    // 白の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    const score = evaluateBoard(board, "black");
    expect(score).toBeLessThan(0);
  });

  it("白の視点では評価が反転する", () => {
    const board = createEmptyBoard();
    // 白の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    const blackScore = evaluateBoard(board, "black");
    const whiteScore = evaluateBoard(board, "white");
    expect(whiteScore).toBeGreaterThan(0);
    expect(blackScore).toBeLessThan(0);
  });

  it("五連がある場合は非常に高いスコア", () => {
    const board = createEmptyBoard();
    // 黒の五連を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const score = evaluateBoard(board, "black");
    expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.FIVE);
  });
});
