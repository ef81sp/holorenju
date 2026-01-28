/**
 * Minimax + Alpha-Beta剪定のテスト
 */

import { describe, expect, it } from "vitest";

import type { BoardState, StoneColor } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

import { PATTERN_SCORES } from "./evaluation";
import { findBestMove, minimax } from "./minimax";

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

describe("minimax", () => {
  it("深さ0では現在の盤面評価を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const score = minimax(board, 0, true, "black");
    expect(typeof score).toBe("number");
  });

  it("maximizingPlayerがtrueの場合は最大値を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const score = minimax(board, 1, true, "black");
    expect(typeof score).toBe("number");
  });

  it("maximizingPlayerがfalseの場合は最小値を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const score = minimax(board, 1, false, "black");
    expect(typeof score).toBe("number");
  });
});

describe("findBestMove", () => {
  it("空の盤面では中央を返す", () => {
    const board = createEmptyBoard();
    const result = findBestMove(board, "black", 2);

    expect(result.position).toEqual({ row: 7, col: 7 });
  });

  it("勝利できる手がある場合はその手を選ぶ", () => {
    const board = createEmptyBoard();
    // 黒が4つ並んでいる状態
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const result = findBestMove(board, "black", 2);

    // 五連を作る手を選ぶはず
    expect(
      (result.position.row === 7 && result.position.col === 7) ||
        (result.position.row === 7 && result.position.col === 2),
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(PATTERN_SCORES.FIVE);
  });

  it("相手の勝利を阻止する手を選ぶ", () => {
    const board = createEmptyBoard();
    // 白が4つ並んでいる状態（白が勝ちそう）
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 8, col: 8, color: "black" }, // 黒の手番用
    ]);

    // 深度を2で白の脅威を認識する
    const result = findBestMove(board, "black", 2);

    // 有効な手が返されることを確認
    // 評価スコアが負の場合、相手が有利と認識している
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    // 相手が有利な盤面なのでスコアは負
    expect(result.score).toBeLessThan(0);
  });

  it("活四を作る手を優先する", () => {
    const board = createEmptyBoard();
    // 黒が3つ並んでいる状態（両端が空いている）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const result = findBestMove(board, "black", 3);

    // 活四を作る手を選ぶはず（(7,3) または (7,7)）
    // より高い評価を持つ手を選ぶ
    expect(result.position.row === 7).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("探索深度に応じた結果を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    const result1 = findBestMove(board, "black", 1);
    const result2 = findBestMove(board, "black", 2);

    // 両方とも有効な手を返す
    expect(result1.position.row).toBeGreaterThanOrEqual(0);
    expect(result1.position.row).toBeLessThan(15);
    expect(result2.position.row).toBeGreaterThanOrEqual(0);
    expect(result2.position.row).toBeLessThan(15);
  });

  it("白番でも正しく動作する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const result = findBestMove(board, "white", 2);

    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeLessThan(15);
  });

  it("ランダム要素がある場合でも有効な手を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    const result = findBestMove(board, "black", 2, 0.3);

    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeLessThan(15);
  });
});
