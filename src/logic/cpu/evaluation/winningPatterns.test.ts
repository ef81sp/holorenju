/**
 * 勝利パターン検出のテスト
 *
 * createsDoubleThree のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { placeStonesOnBoard } from "../testUtils";
import { createsDoubleThree } from "./winningPatterns";

describe("createsDoubleThree", () => {
  it("白が2方向に活三を同時に作れる局面 → true", () => {
    // 横方向: (7,6), (7,7) に白石 → (7,8) に置くと横3連
    // 縦方向: (6,8), (5,8) に白石 → (7,8) に置くと縦3連
    // 両方向とも両端空きで活三
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
    ]);

    expect(createsDoubleThree(board, 7, 8, "white")).toBe(true);
  });

  it("活三が1方向のみ → false", () => {
    // 横方向のみ活三
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    expect(createsDoubleThree(board, 7, 8, "white")).toBe(false);
  });

  it("跳び三を含む三三 → true", () => {
    // 横方向: (7,5), (7,7) に白石 → (7,8) に置くと (7,5)-(7,7)-(7,8) で跳び三
    // 縦方向: (6,8), (5,8) に白石 → (7,8) に置くと連続活三
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
    ]);

    expect(createsDoubleThree(board, 7, 8, "white")).toBe(true);
  });

  it("盤面を変更せずに元に戻す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
    ]);

    createsDoubleThree(board, 7, 8, "white");

    // 石を置いた位置は null のまま
    expect(board[7]?.[8]).toBeNull();
  });

  it("片方の端がブロックされた三は活三ではない → false", () => {
    // 横方向: (7,5)=opponent でブロック
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
    ]);

    // 横方向は止め三（片端ブロック）→ 活三は縦1方向のみ
    expect(createsDoubleThree(board, 7, 8, "white")).toBe(false);
  });

  it("黒でも三三判定できる（汎用関数）", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 6, col: 8, color: "black" },
      { row: 5, col: 8, color: "black" },
    ]);

    expect(createsDoubleThree(board, 7, 8, "black")).toBe(true);
  });
});
