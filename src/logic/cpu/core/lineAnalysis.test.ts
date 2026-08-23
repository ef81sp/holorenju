/**
 * CPUライン解析ユーティリティのテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { placeStonesOnBoard } from "../testUtils";
import { checkEnds, countLine, getLineEnds } from "./lineAnalysis";

describe("countLine", () => {
  it("単独の石は1", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    // 横方向
    expect(countLine(board, 7, 7, 0, 1, "black")).toBe(1);
    // 縦方向
    expect(countLine(board, 7, 7, 1, 0, "black")).toBe(1);
    // 斜め方向
    expect(countLine(board, 7, 7, 1, 1, "black")).toBe(1);
  });

  it("横に3つ並んだ石", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "black" },
    ]);

    // 中央の石から横方向
    expect(countLine(board, 7, 7, 0, 1, "black")).toBe(3);
  });

  it("縦に4つ並んだ石", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 5, col: 7, color: "white" },
      { row: 6, col: 7, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 8, col: 7, color: "white" },
    ]);

    expect(countLine(board, 7, 7, 1, 0, "white")).toBe(4);
  });

  it("斜めに5つ並んだ石", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 5, col: 5, color: "black" },
      { row: 6, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "black" },
      { row: 9, col: 9, color: "black" },
    ]);

    expect(countLine(board, 7, 7, 1, 1, "black")).toBe(5);
  });

  it("途中に相手の石があると分断される", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "white" }, // 相手の石
      { row: 7, col: 8, color: "black" },
      { row: 7, col: 9, color: "black" },
    ]);

    expect(countLine(board, 7, 6, 0, 1, "black")).toBe(2);
    expect(countLine(board, 7, 8, 0, 1, "black")).toBe(2);
  });
});

describe("checkEnds", () => {
  it("両端が空いている活三", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const { end1Open, end2Open } = checkEnds(board, 7, 6, 0, 1, "black");
    expect(end1Open).toBe(true);
    expect(end2Open).toBe(true);
  });

  it("片端が盤端の止め三", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 0, color: "black" },
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
    ]);

    const { end1Open, end2Open } = checkEnds(board, 7, 1, 0, 1, "black");
    // col=3方向は空き、col=-1方向は盤外
    expect(end1Open).toBe(true);
    expect(end2Open).toBe(false);
  });

  it("片端が相手の石で塞がれている", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" }, // 相手の石
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const { end1Open, end2Open } = checkEnds(board, 7, 6, 0, 1, "black");
    // col=8方向は空き、col=4方向は相手の石
    expect(end1Open).toBe(true);
    expect(end2Open).toBe(false);
  });
});

describe("getLineEnds", () => {
  it("両端が空いている場合は両方の位置を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const ends = getLineEnds(board, 7, 6, 0, 1, "black");
    expect(ends).toHaveLength(2);
    expect(ends).toContainEqual({ row: 7, col: 4 });
    expect(ends).toContainEqual({ row: 7, col: 8 });
  });

  it("片端が塞がれている場合は開いている方のみ", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 0, color: "black" },
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
    ]);

    const ends = getLineEnds(board, 7, 1, 0, 1, "black");
    expect(ends).toHaveLength(1);
    expect(ends).toContainEqual({ row: 7, col: 3 });
  });

  it("両端が塞がれている場合は空配列", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    const ends = getLineEnds(board, 7, 6, 0, 1, "black");
    expect(ends).toHaveLength(0);
  });
});
