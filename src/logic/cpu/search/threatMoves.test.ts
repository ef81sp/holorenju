/**
 * 脅威手の判定（共通ロジック）のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { placeStonesOnBoard } from "../testUtils";

import { createsFour, createsOpenThree } from "./threatMoves";

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
