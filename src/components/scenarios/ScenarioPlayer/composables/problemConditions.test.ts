import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";
import type { SuccessCondition } from "@/types/scenario";

import { evaluateAllConditions, evaluateCondition } from "./problemConditions";

// 空の15x15盤面を作成
const createEmptyBoard = (): BoardState =>
  Array(15)
    .fill(null)
    .map(() => Array(15).fill(null));

describe("evaluateCondition", () => {
  describe("position条件", () => {
    it("指定位置に指定色の石があればtrueを返す（or演算子）", () => {
      const board = createEmptyBoard();
      board[7][7] = "black";

      const condition: SuccessCondition = {
        type: "position",
        positions: [{ row: 7, col: 7 }],
        color: "black",
      };

      expect(evaluateCondition(condition, board, "or")).toBe(true);
    });

    it("複数位置のいずれかに石があればtrue（or演算子）", () => {
      const board = createEmptyBoard();
      board[7][7] = "black";

      const condition: SuccessCondition = {
        type: "position",
        positions: [
          { row: 7, col: 7 },
          { row: 0, col: 0 },
        ],
        color: "black",
      };

      expect(evaluateCondition(condition, board, "or")).toBe(true);
    });

    it("全ての指定位置に石が必要（and演算子）", () => {
      const board = createEmptyBoard();
      board[7][7] = "black";
      board[0][0] = "black";

      const condition: SuccessCondition = {
        type: "position",
        positions: [
          { row: 7, col: 7 },
          { row: 0, col: 0 },
        ],
        color: "black",
      };

      expect(evaluateCondition(condition, board, "and")).toBe(true);
    });

    it("and演算子で1つでも欠けていればfalse", () => {
      const board = createEmptyBoard();
      board[7][7] = "black";
      // (0, 0)は空

      const condition: SuccessCondition = {
        type: "position",
        positions: [
          { row: 7, col: 7 },
          { row: 0, col: 0 },
        ],
        color: "black",
      };

      expect(evaluateCondition(condition, board, "and")).toBe(false);
    });

    it("指定位置に石がなければfalseを返す", () => {
      const board = createEmptyBoard();

      const condition: SuccessCondition = {
        type: "position",
        positions: [{ row: 7, col: 7 }],
        color: "black",
      };

      expect(evaluateCondition(condition, board, "or")).toBe(false);
    });

    it("色が一致しなければfalseを返す", () => {
      const board = createEmptyBoard();
      board[7][7] = "white"; // 白石を置く

      const condition: SuccessCondition = {
        type: "position",
        positions: [{ row: 7, col: 7 }],
        color: "black", // 黒を期待
      };

      expect(evaluateCondition(condition, board, "or")).toBe(false);
    });

    it("空の盤面ではfalseを返す", () => {
      const board = createEmptyBoard();

      const condition: SuccessCondition = {
        type: "position",
        positions: [
          { row: 7, col: 7 },
          { row: 0, col: 0 },
        ],
        color: "black",
      };

      expect(evaluateCondition(condition, board, "or")).toBe(false);
      expect(evaluateCondition(condition, board, "and")).toBe(false);
    });

    it("デフォルト演算子はor", () => {
      const board = createEmptyBoard();
      board[7][7] = "black";

      const condition: SuccessCondition = {
        type: "position",
        positions: [
          { row: 7, col: 7 },
          { row: 0, col: 0 },
        ],
        color: "black",
      };

      // 演算子省略時はor
      expect(evaluateCondition(condition, board)).toBe(true);
    });
  });

  describe("pattern条件", () => {
    it("未実装なのでfalseを返す", () => {
      const board = createEmptyBoard();

      const condition: SuccessCondition = {
        type: "pattern",
        pattern: "xxxxx",
        color: "black",
      };

      expect(evaluateCondition(condition, board, "or")).toBe(false);
    });
  });

  describe("sequence条件", () => {
    it("未実装なのでfalseを返す", () => {
      const board = createEmptyBoard();

      const condition: SuccessCondition = {
        type: "sequence",
        moves: [{ row: 7, col: 7, color: "black" }],
        strict: false,
      };

      expect(evaluateCondition(condition, board, "or")).toBe(false);
    });
  });

  describe("vcf条件", () => {
    it("静的条件チェックではないためfalseを返す", () => {
      const board = createEmptyBoard();

      const condition: SuccessCondition = {
        type: "vcf",
        color: "black",
      };

      expect(evaluateCondition(condition, board, "or")).toBe(false);
    });
  });

  describe("vct条件", () => {
    it("静的条件チェックではないためfalseを返す", () => {
      const board = createEmptyBoard();

      const condition: SuccessCondition = {
        type: "vct",
        color: "black",
      };

      expect(evaluateCondition(condition, board, "or")).toBe(false);
    });
  });
});

describe("evaluateAllConditions", () => {
  describe("or演算子", () => {
    it("いずれかの条件を満たせばtrue", () => {
      const board = createEmptyBoard();
      board[7][7] = "black";

      const conditions: SuccessCondition[] = [
        { type: "position", positions: [{ row: 7, col: 7 }], color: "black" },
        { type: "position", positions: [{ row: 0, col: 0 }], color: "black" },
      ];

      expect(evaluateAllConditions(conditions, board, "or")).toBe(true);
    });

    it("全ての条件を満たさなければfalse", () => {
      const board = createEmptyBoard();

      const conditions: SuccessCondition[] = [
        { type: "position", positions: [{ row: 7, col: 7 }], color: "black" },
        { type: "position", positions: [{ row: 0, col: 0 }], color: "black" },
      ];

      expect(evaluateAllConditions(conditions, board, "or")).toBe(false);
    });
  });

  describe("and演算子", () => {
    it("全ての条件を満たせばtrue", () => {
      const board = createEmptyBoard();
      board[7][7] = "black";
      board[0][0] = "black";

      const conditions: SuccessCondition[] = [
        { type: "position", positions: [{ row: 7, col: 7 }], color: "black" },
        { type: "position", positions: [{ row: 0, col: 0 }], color: "black" },
      ];

      expect(evaluateAllConditions(conditions, board, "and")).toBe(true);
    });

    it("1つでも満たさなければfalse", () => {
      const board = createEmptyBoard();
      board[7][7] = "black";
      // (0, 0)は空

      const conditions: SuccessCondition[] = [
        { type: "position", positions: [{ row: 7, col: 7 }], color: "black" },
        { type: "position", positions: [{ row: 0, col: 0 }], color: "black" },
      ];

      expect(evaluateAllConditions(conditions, board, "and")).toBe(false);
    });
  });

  describe("空の条件配列", () => {
    it("or演算子ならfalse", () => {
      const board = createEmptyBoard();
      expect(evaluateAllConditions([], board, "or")).toBe(false);
    });

    it("and演算子ならtrue", () => {
      const board = createEmptyBoard();
      expect(evaluateAllConditions([], board, "and")).toBe(true);
    });
  });

  it("デフォルト演算子はor", () => {
    const board = createEmptyBoard();
    board[7][7] = "black";

    const conditions: SuccessCondition[] = [
      { type: "position", positions: [{ row: 7, col: 7 }], color: "black" },
      { type: "position", positions: [{ row: 0, col: 0 }], color: "black" },
    ];

    // 演算子省略時はor
    expect(evaluateAllConditions(conditions, board)).toBe(true);
  });
});
