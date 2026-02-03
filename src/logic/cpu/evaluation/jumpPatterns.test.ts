/**
 * 跳びパターン評価機能のテスト
 *
 * 跳び四、跳び三の評価テスト
 */

import { describe, expect, it } from "vitest";

import { evaluateStonePatterns } from "../evaluation";
import { createBoardWithStones } from "../testUtils";
import { PATTERN_SCORES } from "./patternScores";

describe("跳びパターン評価", () => {
  describe("跳び四", () => {
    it("跳び四（●●●・●）はFOURスコアで評価", () => {
      // ●●●・● パターン: 7行目に [3]=黒, [4]=黒, [5]=黒, [6]=空, [7]=黒
      const board = createBoardWithStones([
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 4, color: "black" },
        { row: 7, col: 5, color: "black" },
        { row: 7, col: 7, color: "black" },
      ]);

      // 中央の石で評価
      const score = evaluateStonePatterns(board, 7, 5, "black");
      expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.FOUR);
    });

    it("跳び四（●●・●●）はFOURスコアで評価", () => {
      // ●●・●● パターン: 7行目に [3]=黒, [4]=黒, [5]=空, [6]=黒, [7]=黒
      const board = createBoardWithStones([
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 4, color: "black" },
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
      ]);

      const score = evaluateStonePatterns(board, 7, 4, "black");
      expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.FOUR);
    });

    it("跳び四（●・●●●）はFOURスコアで評価", () => {
      // ●・●●● パターン: 7行目に [3]=黒, [4]=空, [5]=黒, [6]=黒, [7]=黒
      const board = createBoardWithStones([
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 5, color: "black" },
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
      ]);

      const score = evaluateStonePatterns(board, 7, 5, "black");
      expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.FOUR);
    });
  });

  describe("跳び三", () => {
    it("活跳び三（・●●・●・）はOPEN_THREEスコアで評価", () => {
      // ・●●・●・ パターン: 7行目に [2]=空, [3]=黒, [4]=黒, [5]=空, [6]=黒, [7]=空
      const board = createBoardWithStones([
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 4, color: "black" },
        { row: 7, col: 6, color: "black" },
      ]);

      const score = evaluateStonePatterns(board, 7, 4, "black");
      expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.OPEN_THREE);
    });

    it("活跳び三（・●・●●・）はOPEN_THREEスコアで評価", () => {
      // ・●・●●・ パターン: 7行目に [2]=空, [3]=黒, [4]=空, [5]=黒, [6]=黒, [7]=空
      const board = createBoardWithStones([
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 5, color: "black" },
        { row: 7, col: 6, color: "black" },
      ]);

      const score = evaluateStonePatterns(board, 7, 5, "black");
      expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.OPEN_THREE);
    });
  });
});
