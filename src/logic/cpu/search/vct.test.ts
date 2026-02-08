/**
 * VCT探索のテスト
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

import { createBoardWithStones } from "../testUtils";
import {
  countStones,
  findVCTMove,
  findVCTSequence,
  hasVCT,
  isVCTFirstMove,
  VCT_STONE_THRESHOLD,
} from "./vct";

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

describe("VCTSearchOptions付きテスト", () => {
  it("拡張時間制限でhasVCTが動作する", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(
      hasVCT(board, "black", 0, undefined, { maxDepth: 6, timeLimit: 1000 }),
    ).toBe(true);
  });

  it("深度0ではVCTなし", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(hasVCT(board, "black", 0, undefined, { maxDepth: 0 })).toBe(false);
  });
});

describe("findVCTMove", () => {
  it("VCF成立時はVCFの手を返す", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const move = findVCTMove(board, "black");
    expect(move).not.toBeNull();
    expect(move?.row).toBe(7);
    expect([4, 8]).toContain(move?.col);
  });

  it("VCTなしの場合はnullを返す", () => {
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    expect(findVCTMove(board, "black")).toBeNull();
  });
});

describe("findVCTSequence", () => {
  it("VCF成立時はVCF手順を返す", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const result = findVCTSequence(board, "black");
    expect(result).not.toBeNull();
    expect(result?.sequence.length).toBeGreaterThanOrEqual(1);
  });

  it("VCTなしの場合はnullを返す", () => {
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    expect(findVCTSequence(board, "black")).toBeNull();
  });
});

describe("isVCTFirstMove", () => {
  it("活三を作る手はVCT開始手", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // (7,4) or (7,8) はVCF開始手でもある
    expect(isVCTFirstMove(board, { row: 7, col: 4 }, "black")).toBe(true);
    expect(isVCTFirstMove(board, { row: 7, col: 8 }, "black")).toBe(true);
  });

  it("無関係な手はVCT開始手でない", () => {
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    expect(isVCTFirstMove(board, { row: 0, col: 0 }, "black")).toBe(false);
  });
});

describe("ユーザ報告の棋譜テスト", () => {
  // 棋譜: H8 H7 H6 I7 G7 I5 G8 F8 G6 G5 E6 F6 F7 H9 E7 E5 C4 D5 F5 D7 K3 J6 H10 H4 ...
  // 23手目まで（H4の直前の局面）で白にVCTが存在することを確認
  // H4はJ6-I5-H4のナナメの活三を作り、VCT開始手として有効
  const record =
    "H8 H7 H6 I7 G7 I5 G8 F8 G6 G5 E6 F6 F7 H9 E7 E5 C4 D5 F5 D7 K3 J6 H10";
  const options = {
    maxDepth: 6,
    timeLimit: 5000,
    vcfOptions: { maxDepth: 16, timeLimit: 5000 },
  };

  it("24手目は白番", () => {
    const { nextColor } = createBoardFromRecord(record);
    expect(nextColor).toBe("white");
  });

  it("H4がJ6-I5-H4のナナメの活三を作りVCT開始手と判定される", () => {
    const { board } = createBoardFromRecord(record);
    // H4 → row=11, col=7（白番）
    const h4 = { row: 11, col: 7 };
    expect(isVCTFirstMove(board, h4, "white", options)).toBe(true);
  });

  it("findVCTMoveが白のVCT開始手を見つける", () => {
    const { board } = createBoardFromRecord(record);
    const move = findVCTMove(board, "white", options);
    expect(move).not.toBeNull();
  });

  it("findVCTSequenceが白のVCT手順を返す", () => {
    const { board } = createBoardFromRecord(record);
    const result = findVCTSequence(board, "white", options);
    expect(result).not.toBeNull();
    expect(result?.sequence.length).toBeGreaterThanOrEqual(3);
  });

  it("VCT開始手がisVCTFirstMoveで検証される", () => {
    const { board } = createBoardFromRecord(record);
    const move = findVCTMove(board, "white", options);
    expect(move).not.toBeNull();
    if (move) {
      expect(isVCTFirstMove(board, move, "white", options)).toBe(true);
    }
  });
});
