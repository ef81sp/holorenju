/**
 * 跳びパターン評価機能のテスト
 *
 * 跳び四、跳び三の評価テスト
 */

import { describe, expect, it } from "vitest";

import { evaluateStonePatterns } from "../evaluation";
import { createBoardWithStones } from "../testUtils";
import { analyzeJumpPatterns } from "./jumpPatterns";
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

describe("analyzeJumpPatterns - 連続四の端チェック", () => {
  it("両端塞がりの連続四はhasFour=falseになる", () => {
    // 縦方向: 黒○○○○黒 のパターン（白4連だが両端が黒で塞がり）
    // col=7の縦方向: row=3=黒, row=4〜7=白, row=8=黒
    const board = createBoardWithStones([
      { row: 3, col: 7, color: "black" },
      { row: 4, col: 7, color: "white" },
      { row: 5, col: 7, color: "white" },
      { row: 6, col: 7, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 8, col: 7, color: "black" },
    ]);

    // row=5, col=7の白石で評価
    const result = analyzeJumpPatterns(board, 5, 7, "white");
    expect(result.hasFour).toBe(false);
  });

  it("片端塞がり・片端空きの連続四はhasFour=trueになる", () => {
    // 縦方向: 黒○○○○・ のパターン（白4連、片端黒・片端空き → 止め四）
    // col=7の縦方向: row=3=黒, row=4〜7=白, row=8=空
    const board = createBoardWithStones([
      { row: 3, col: 7, color: "black" },
      { row: 4, col: 7, color: "white" },
      { row: 5, col: 7, color: "white" },
      { row: 6, col: 7, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    const result = analyzeJumpPatterns(board, 5, 7, "white");
    expect(result.hasFour).toBe(true);
  });

  it("両端空きの連続四はhasOpenFour=trueになる", () => {
    // 縦方向: ・○○○○・ のパターン（白4連、両端空き → 活四）
    // col=7の縦方向: row=4〜7=白
    const board = createBoardWithStones([
      { row: 4, col: 7, color: "white" },
      { row: 5, col: 7, color: "white" },
      { row: 6, col: 7, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    const result = analyzeJumpPatterns(board, 5, 7, "white");
    expect(result.hasFour).toBe(true);
    expect(result.hasOpenFour).toBe(true);
  });

  it("両端塞がりの四+活三は四三と判定されない", () => {
    // 実戦パターン: K列縦方向に白4連だが両端が黒、斜めに活三
    // K6-K7-K8-K9=白4連、K5=黒、K10=黒 → 死に四
    // K9起点で斜めに活三あり → 本来は四三ではない
    const board = createBoardWithStones([
      // K列縦方向: 両端塞がり四
      { row: 4, col: 10, color: "black" }, // K10
      { row: 5, col: 10, color: "white" }, // K9（評価対象）
      { row: 6, col: 10, color: "white" }, // K8
      { row: 7, col: 10, color: "white" }, // K7
      { row: 8, col: 10, color: "white" }, // K6
      { row: 9, col: 10, color: "black" }, // K5
      // 斜め方向に活三を構成（K9-J10-I11方向に白3連）
      { row: 3, col: 9, color: "white" }, // J11（斜め延長）
    ]);

    const result = analyzeJumpPatterns(board, 5, 10, "white");
    // 両端塞がりの四はhasFourにならない
    expect(result.hasFour).toBe(false);
    // したがって四三（hasFour && hasValidOpenThree）にもならない
  });
});
