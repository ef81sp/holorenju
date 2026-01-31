/**
 * VCT探索のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { createBoardWithStones } from "./testUtils";
import { countStones, hasVCT, VCT_STONE_THRESHOLD } from "./vct";

describe("hasVCT", () => {
  it("空の盤面ではVCTなし", () => {
    const board = createEmptyBoard();
    expect(hasVCT(board, "black")).toBe(false);
    expect(hasVCT(board, "white")).toBe(false);
  });

  it("VCFがある場合はVCT成立（VCF ⊂ VCT）", () => {
    // 活三の状態（両端が空いている）- これはVCFでもある
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(hasVCT(board, "black")).toBe(true);
  });

  it("活四がある場合はVCT成立", () => {
    // 活四の形
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(hasVCT(board, "black")).toBe(true);
  });

  it("白の活三からVCTが成立する", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    expect(hasVCT(board, "white")).toBe(true);
  });

  it("連続した脅威で勝利できる場合はVCT成立", () => {
    // 2方向に三がある形
    const board = createBoardWithStones([
      // 横に三
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      // 縦に三
      { row: 4, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
      { row: 6, col: 8, color: "white" },
    ]);
    expect(hasVCT(board, "white")).toBe(true);
  });

  it("深さ制限内でVCTが成立しない場合はfalse", () => {
    // 1石だけでは4手以内にVCTは成立しない
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    expect(hasVCT(board, "black")).toBe(false);
  });

  it("単独の活三でもVCT成立（活三→活四→勝利）", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 活三から四を作れば活四になり勝利
    expect(hasVCT(board, "black")).toBe(true);
  });
});

describe("countStones", () => {
  it("空の盤面は石数0", () => {
    const board = createEmptyBoard();
    expect(countStones(board)).toBe(0);
  });

  it("石数を正しくカウント", () => {
    const board = createBoardWithStones([
      { row: 0, col: 0, color: "black" },
      { row: 7, col: 7, color: "white" },
      { row: 14, col: 14, color: "black" },
    ]);
    expect(countStones(board)).toBe(3);
  });
});

describe("VCT_STONE_THRESHOLD", () => {
  it("閾値が20に設定されている", () => {
    expect(VCT_STONE_THRESHOLD).toBe(20);
  });
});
