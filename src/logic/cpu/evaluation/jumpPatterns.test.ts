/**
 * 跳びパターン評価機能のテスト
 *
 * 跳び四、跳び三の評価テスト
 */

import { describe, expect, it } from "vitest";

import { checkStraightFour } from "@/logic/renjuRules";

import { evaluateStonePatterns } from "../evaluation";
import { createBoardWithStones } from "../testUtils";
import { analyzeJumpPatterns, isValidConsecutiveThree } from "./jumpPatterns";
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

describe("白の制約ライン上の偽活三", () => {
  describe("checkStraightFour - 白対応", () => {
    it("制約ライン上の白三の達四点 → false（活四にならない）", () => {
      // 縦方向: B _ W W W _ B
      // col=5: row=4=黒, row=5=空, row=6〜8=白, row=9=空, row=10=黒
      // 達四点 row=5: 仮置きで4連→ row=4=黒で片端塞がり
      // 達四点 row=9: 仮置きで4連→ row=10=黒で片端塞がり
      const board = createBoardWithStones([
        { row: 4, col: 5, color: "black" },
        { row: 6, col: 5, color: "white" },
        { row: 7, col: 5, color: "white" },
        { row: 8, col: 5, color: "white" },
        { row: 10, col: 5, color: "black" },
      ]);

      // dirIndex=0 は上方向（dr=-1, dc=0）
      expect(checkStraightFour(board, 5, 5, 0, "white")).toBe(false);
      expect(checkStraightFour(board, 9, 5, 0, "white")).toBe(false);
    });

    it("非制約ライン上の白三の達四点 → true（活四になる）", () => {
      // 縦方向: _ _ W W W _ _
      const board = createBoardWithStones([
        { row: 6, col: 5, color: "white" },
        { row: 7, col: 5, color: "white" },
        { row: 8, col: 5, color: "white" },
      ]);

      // 達四点 row=5 に仮置き → 両端空き → true
      expect(checkStraightFour(board, 5, 5, 0, "white")).toBe(true);
    });
  });

  describe("isValidConsecutiveThree - 白対応", () => {
    it("制約ライン [B] _ W W W _ [B] の白三 → false（活三ではない）", () => {
      // col=5 縦方向: row=4=黒, row=6〜8=白, row=10=黒
      // row=5, row=9 は空き（達四点）
      // 達四点に置いても 5マスの制約で活四にならない
      const board = createBoardWithStones([
        { row: 4, col: 5, color: "black" },
        { row: 6, col: 5, color: "white" },
        { row: 7, col: 5, color: "white" },
        { row: 8, col: 5, color: "white" },
        { row: 10, col: 5, color: "black" },
      ]);

      // dirIndex=0 (上方向)
      expect(isValidConsecutiveThree(board, 7, 5, 0, "white")).toBe(false);
    });

    it("非制約ラインの白三 → true", () => {
      // col=5 縦方向: _ W W W _ （両端十分に空き）
      const board = createBoardWithStones([
        { row: 6, col: 5, color: "white" },
        { row: 7, col: 5, color: "white" },
        { row: 8, col: 5, color: "white" },
      ]);

      expect(isValidConsecutiveThree(board, 7, 5, 0, "white")).toBe(true);
    });
  });

  describe("analyzeJumpPatterns - 白の制約ライン三", () => {
    it("制約ライン上の白連続三 → hasValidOpenThree=false", () => {
      // B _ W W W _ B パターン
      const board = createBoardWithStones([
        { row: 4, col: 5, color: "black" },
        { row: 6, col: 5, color: "white" },
        { row: 7, col: 5, color: "white" },
        { row: 8, col: 5, color: "white" },
        { row: 10, col: 5, color: "black" },
      ]);

      const result = analyzeJumpPatterns(board, 7, 5, "white");
      expect(result.hasValidOpenThree).toBe(false);
    });

    it("非制約ラインの白連続三 → hasValidOpenThree=true", () => {
      const board = createBoardWithStones([
        { row: 6, col: 5, color: "white" },
        { row: 7, col: 5, color: "white" },
        { row: 8, col: 5, color: "white" },
      ]);

      const result = analyzeJumpPatterns(board, 7, 5, "white");
      expect(result.hasValidOpenThree).toBe(true);
    });
  });
});
