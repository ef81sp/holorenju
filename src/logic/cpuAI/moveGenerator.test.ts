/**
 * 候補手生成のテスト
 */

import { describe, expect, it } from "vitest";

import type { BoardState, StoneColor } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

import { generateMoves, isNearExistingStone } from "./moveGenerator";

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

describe("generateMoves", () => {
  it("空の盤面では中央のみを返す", () => {
    const board = createEmptyBoard();
    const moves = generateMoves(board, "black");

    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual({ row: 7, col: 7 });
  });

  it("石がある場合は周囲2マスの空きマスを返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const moves = generateMoves(board, "white");

    // 周囲2マスの空きマスを確認
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => board[m.row]?.[m.col] === null)).toBe(true);

    // 中央(7,7)は石があるので候補に含まれない
    expect(moves.find((m) => m.row === 7 && m.col === 7)).toBeUndefined();
  });

  it("黒番の場合、禁手となるマスは候補に含まれない", () => {
    const board = createEmptyBoard();
    // 三三を作る準備
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    const moves = generateMoves(board, "black");

    // (7,7)は三三の禁手になるので候補に含まれない
    const forbiddenMove = moves.find((m) => m.row === 7 && m.col === 7);
    expect(forbiddenMove).toBeUndefined();
  });

  it("白番の場合、禁手チェックは行わない", () => {
    const board = createEmptyBoard();
    // 三三の形を作る（白は禁手なし）
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 5, col: 7, color: "white" },
      { row: 6, col: 7, color: "white" },
    ]);

    const moves = generateMoves(board, "white");

    // (7,7)は候補に含まれる（白は禁手なし）
    const move = moves.find((m) => m.row === 7 && m.col === 7);
    expect(move).toBeDefined();
  });

  it("五連が作れる場合は禁手の位置でも候補に含まれる（黒番）", () => {
    const board = createEmptyBoard();
    // 五連を作る準備（四四の形だが五連を作れる）
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const moves = generateMoves(board, "black");

    // (7,7)は五連を作れるので候補に含まれる
    const winningMove = moves.find((m) => m.row === 7 && m.col === 7);
    expect(winningMove).toBeDefined();
  });

  it("盤面外の位置は候補に含まれない", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 0, col: 0, color: "black" }]);

    const moves = generateMoves(board, "white");

    // すべての候補が盤面内
    for (const move of moves) {
      expect(move.row).toBeGreaterThanOrEqual(0);
      expect(move.row).toBeLessThan(15);
      expect(move.col).toBeGreaterThanOrEqual(0);
      expect(move.col).toBeLessThan(15);
    }
  });

  it("候補手は重複しない", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    const moves = generateMoves(board, "black");

    // 重複チェック
    const uniqueMoves = new Set(moves.map((m) => `${m.row},${m.col}`));
    expect(uniqueMoves.size).toBe(moves.length);
  });
});
