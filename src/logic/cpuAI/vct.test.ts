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

describe("石数閾値の動作", () => {
  it("20石未満の盤面でもVCT探索は実行される（即VCF判定のみ）", () => {
    // 活三の状態（VCFでもある）
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 石数は3個で20未満だが、VCFがあるのでVCT成立
    expect(countStones(board)).toBe(3);
    expect(hasVCT(board, "black")).toBe(true);
  });

  it("20石以上の盤面ではVCT探索が実行される", () => {
    // 20石以上の盤面を作成
    const stones: { row: number; col: number; color: "black" | "white" }[] = [];
    // 交互に石を配置（VCFにならない形で）
    for (let i = 0; i < 10; i++) {
      stones.push({ row: 0, col: i, color: "black" });
      stones.push({ row: 14, col: i, color: "white" });
    }
    // 黒の活三を追加
    stones.push({ row: 7, col: 5, color: "black" });
    stones.push({ row: 7, col: 6, color: "black" });
    stones.push({ row: 7, col: 7, color: "black" });

    const board = createBoardWithStones(stones);
    expect(countStones(board)).toBeGreaterThanOrEqual(20);
    expect(hasVCT(board, "black")).toBe(true);
  });
});

describe("VCTゴールデンテスト", () => {
  // 既存の振る舞いを保証するスナップショットテスト
  const testCases = [
    {
      name: "空の盤面はVCTなし",
      stones: [] as { row: number; col: number; color: "black" | "white" }[],
      color: "black" as const,
      expected: false,
    },
    {
      name: "黒の活三からVCT成立（VCF ⊂ VCT）",
      stones: [
        { row: 7, col: 5, color: "black" as const },
        { row: 7, col: 6, color: "black" as const },
        { row: 7, col: 7, color: "black" as const },
      ],
      color: "black" as const,
      expected: true,
    },
    {
      name: "白の斜め活三からVCT成立",
      stones: [
        { row: 5, col: 5, color: "white" as const },
        { row: 6, col: 6, color: "white" as const },
        { row: 7, col: 7, color: "white" as const },
      ],
      color: "white" as const,
      expected: true,
    },
    {
      name: "1石だけではVCTなし",
      stones: [{ row: 7, col: 7, color: "black" as const }],
      color: "black" as const,
      expected: false,
    },
  ];

  testCases.forEach(({ name, stones, color, expected }) => {
    it(name, () => {
      const board = createBoardWithStones(stones);
      expect(hasVCT(board, color)).toBe(expected);
    });
  });
});
