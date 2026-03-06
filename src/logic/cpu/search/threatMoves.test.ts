/**
 * 脅威手の判定（共通ロジック）のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { placeStonesOnBoard } from "../testUtils";
import { classifyThreat, createsFour, createsOpenThree } from "./threatMoves";

describe("createsFour", () => {
  it("連続四を検出", () => {
    const board = createEmptyBoard();
    // 4つ並べる → 四
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    expect(createsFour(board, 7, 7, "black")).toBe(true);
    expect(createsFour(board, 7, 6, "black")).toBe(true);
  });

  it("3連では四にならない", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    expect(createsFour(board, 7, 7, "black")).toBe(false);
  });

  it("両端塞がりは四にならない", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" }, // 塞ぎ
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" }, // 塞ぎ
    ]);

    expect(createsFour(board, 7, 6, "black")).toBe(false);
  });

  it("跳び四を検出", () => {
    const board = createEmptyBoard();
    // ●●●・● パターン
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      // col: 6 は空き
      { row: 7, col: 7, color: "black" },
    ]);

    expect(createsFour(board, 7, 5, "black")).toBe(true);
  });

  it("白も四を作れる", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    expect(createsFour(board, 7, 7, "white")).toBe(true);
  });

  it("縦方向の四", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 4, col: 7, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    expect(createsFour(board, 6, 7, "black")).toBe(true);
  });

  it("斜め方向の四", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 4, col: 4, color: "black" },
      { row: 5, col: 5, color: "black" },
      { row: 6, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    expect(createsFour(board, 6, 6, "black")).toBe(true);
  });

  // =========================================================================
  // 長連筋の四を無効とする修正のテスト
  // =========================================================================

  it("バグ再現: D11白 E11-H11黒4連 I11空 J11黒 → 横方向の四は無効", () => {
    // 盤面座標: row=0が15段目、row=14が1段目
    // 11段目 = row 4, D=col3, E=col4, H=col7, I=col8, J=col9
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 4, col: 3, color: "white" }, // D11（反対端を塞ぐ）
      { row: 4, col: 4, color: "black" }, // E11
      { row: 4, col: 5, color: "black" }, // F11
      { row: 4, col: 6, color: "black" }, // G11
      { row: 4, col: 7, color: "black" }, // H11（起点）
      // I11 (col:8) は空き
      { row: 4, col: 9, color: "black" }, // J11
    ]);

    // end1(I11)は長連で無効、end2(D11)は白石で塞がり → 横方向に四なし
    expect(createsFour(board, 4, 7, "black")).toBe(false);
  });

  it("片端のみ長連、もう片端有効 → createsFour = true", () => {
    const board = createEmptyBoard();
    // ・●●●●・● : col2空 col3-6黒 col7空 col8黒
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 8, color: "black" }, // 長連側
    ]);

    // col2 側は有効な四なので true
    expect(createsFour(board, 7, 5, "black")).toBe(true);
  });

  it("両端長連 → createsFour = false", () => {
    const board = createEmptyBoard();
    // ●・●●●●・● : col2黒 col3空 col4-7黒 col8空 col9黒
    placeStonesOnBoard(board, [
      { row: 7, col: 2, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 9, color: "black" },
    ]);

    expect(createsFour(board, 7, 5, "black")).toBe(false);
  });

  it("跳び四 ●●●・●● で黒 → 長連なので false", () => {
    const board = createEmptyBoard();
    // col3●col4●col5●col6・col7●col8● → ギャップ埋めると6連
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      // col6 空き（ギャップ）
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "black" },
    ]);

    expect(createsFour(board, 7, 5, "black")).toBe(false);
  });

  it("跳び四 ●●●・●・ で黒 → 有効な跳び四", () => {
    const board = createEmptyBoard();
    // col3●col4●col5●col6・col7●col8・
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      // col6 空き（ギャップ）
      { row: 7, col: 7, color: "black" },
    ]);

    expect(createsFour(board, 7, 5, "black")).toBe(true);
  });

  it("白で同パターン → true（長連ルールなし）", () => {
    const board = createEmptyBoard();
    // 白で両端長連パターンでも有効
    placeStonesOnBoard(board, [
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 7, col: 9, color: "white" },
    ]);

    expect(createsFour(board, 7, 5, "white")).toBe(true);
  });

  it("classifyThreat でも同じ長連判定", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 4, col: 3, color: "white" }, // 反対端を塞ぐ
      { row: 4, col: 4, color: "black" },
      { row: 4, col: 5, color: "black" },
      { row: 4, col: 6, color: "black" },
      { row: 4, col: 7, color: "black" },
      { row: 4, col: 9, color: "black" },
    ]);

    const result = classifyThreat(board, 4, 7, "black");
    expect(result.createsFour).toBe(false);
  });
});

describe("createsOpenThree", () => {
  it("連続活三を検出", () => {
    const board = createEmptyBoard();
    // 3つ並べる（両端空き）→ 活三
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    expect(createsOpenThree(board, 7, 6, "black")).toBe(true);
  });

  it("止め三は活三でない", () => {
    const board = createEmptyBoard();
    // 片端塞がり
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" }, // 塞ぎ
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    expect(createsOpenThree(board, 7, 6, "black")).toBe(false);
  });

  it("2連は活三でない", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    expect(createsOpenThree(board, 7, 7, "black")).toBe(false);
  });

  it("跳び三を検出", () => {
    const board = createEmptyBoard();
    // ・●●・●・ パターン
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      // col: 6 は空き
      { row: 7, col: 7, color: "black" },
    ]);

    expect(createsOpenThree(board, 7, 5, "black")).toBe(true);
  });

  it("白も活三を作れる", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    expect(createsOpenThree(board, 7, 6, "white")).toBe(true);
  });

  it("縦方向の活三", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    expect(createsOpenThree(board, 6, 7, "black")).toBe(true);
  });

  it("斜め方向の活三", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 5, col: 5, color: "black" },
      { row: 6, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    expect(createsOpenThree(board, 6, 6, "black")).toBe(true);
  });
});
