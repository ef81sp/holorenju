/**
 * 勝利パターン検出のテスト
 *
 * createsDoubleThree のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { placeStonesOnBoard } from "../testUtils";
import {
  createsDoubleThree,
  createsFourThree,
  detectWhiteWinningPattern,
} from "./winningPatterns";

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

describe("detectWhiteWinningPattern", () => {
  it("四四 → 'double-four'", () => {
    // 横方向: (7,5),(7,6),(7,7) に白石 → (7,8) に置くと横4連
    // 縦方向: (6,8),(5,8),(4,8) に白石 → (7,8) に置くと縦4連
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
      { row: 4, col: 8, color: "white" },
    ]);

    expect(detectWhiteWinningPattern(board, 7, 8)).toBe("double-four");
  });

  it("三三 → 'double-three'", () => {
    // 横方向: (7,6),(7,7) に白石 → (7,8) に置くと横活三
    // 縦方向: (6,8),(5,8) に白石 → (7,8) に置くと縦活三
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
    ]);

    expect(detectWhiteWinningPattern(board, 7, 8)).toBe("double-three");
  });

  it("該当なし → null", () => {
    // 1方向にしかパターンなし
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    expect(detectWhiteWinningPattern(board, 7, 8)).toBeNull();
  });
});

describe("createsFourThree - issue #121 黒の偽跳び四（ギャップ埋めが長連）", () => {
  it("偽跳び四は四に数えない（四三ではない）", () => {
    const board = createEmptyBoard();
    // 横 8 行目: 黒 C8 D8 _ F8 G8 [H8=着手点]
    // 縦 H 列: 黒 H10 H9 [H8=着手点] → 両端空きの活三
    placeStonesOnBoard(board, [
      { row: 7, col: 2, color: "black" },
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    // H8 に打つと LUT は横方向を跳び四と報告するが、窓（中心 ±4）の外の C8 のせいで
    // E8 を埋めると C8..H8 の 6 連＝長連。横方向に五点は無く四ではない。
    expect(createsFourThree(board, 7, 7, "black")).toBe(false);
  });

  it("同じ形でも白なら本物の四三（回帰・白に長連の制限は無い）", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 5, col: 7, color: "white" },
      { row: 6, col: 7, color: "white" },
    ]);

    expect(createsFourThree(board, 7, 7, "white")).toBe(true);
  });
});
