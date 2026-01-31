/**
 * VCF探索のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { createBoardWithStones } from "./testUtils";
import { hasVCF } from "./vcf";

describe("hasVCF", () => {
  it("空の盤面ではVCFなし", () => {
    const board = createEmptyBoard();
    expect(hasVCF(board, "black")).toBe(false);
    expect(hasVCF(board, "white")).toBe(false);
  });

  it("三連から四を作れて五連に繋がる場合はVCF成立", () => {
    // 活三の状態（両端が空いている）
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 両端どちらかに置けば四が作れ、活四なら即勝ち
    expect(hasVCF(board, "black")).toBe(true);
  });

  it("活四がある場合はVCF成立", () => {
    // 活四の形（両端が空いている四）
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // すでに活四があるので実質勝ち
    // hasVCFは四を作る位置を探すので、この状態では追加の四は作れない
    // ただし、これは五連が作れる状態なのでVCFとしては成立
    expect(hasVCF(board, "black")).toBe(true);
  });

  it("白の活三からVCFが成立する", () => {
    // 白の活三（両端が空いている）
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    // 白も活三から四を作れば活四になり勝利
    expect(hasVCF(board, "white")).toBe(true);
  });

  it("連続して四を作って勝利できる場合はVCF成立", () => {
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
    // 7,8に置くと横方向で四、8,8に置くと縦方向で四
    // どちらかで五連に繋がれるならVCF成立
    expect(hasVCF(board, "white")).toBe(true);
  });

  it("深さ制限内でVCFが成立しない場合はfalse", () => {
    // 8手以上かかるVCFはfalseを返す
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    expect(hasVCF(board, "black")).toBe(false);
  });
});
