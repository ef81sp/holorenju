/**
 * 方向パターン分析のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { placeStonesOnBoard } from "../testUtils";
import {
  analyzeDirection,
  applyDefenseMultiplier,
  countInDirection,
  DEFENSE_MULTIPLIERS,
  getCenterBonus,
  getPatternScore,
  getPatternType,
} from "./directionAnalysis";
import { PATTERN_SCORES } from "./patternScores";

describe("countInDirection", () => {
  it("指定方向の連続石をカウント", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "black" },
      { row: 7, col: 9, color: "black" },
    ]);

    // 7,7から右方向（dr=0, dc=1）
    const result = countInDirection(board, 7, 7, 0, 1, "black");
    expect(result.count).toBe(2); // 8, 9の2つ
    expect(result.endState).toBe("empty"); // 10は空き
  });

  it("端が相手の石の場合", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "black" },
      { row: 7, col: 9, color: "white" }, // 相手の石
    ]);

    const result = countInDirection(board, 7, 7, 0, 1, "black");
    expect(result.count).toBe(1);
    expect(result.endState).toBe("opponent");
  });

  it("端が盤端の場合", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 13, color: "black" },
      { row: 7, col: 14, color: "black" },
    ]);

    const result = countInDirection(board, 7, 13, 0, 1, "black");
    expect(result.count).toBe(1);
    expect(result.endState).toBe("edge");
  });
});

describe("analyzeDirection", () => {
  it("両方向の連続石を合算", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" }, // 起点
      { row: 7, col: 8, color: "black" },
    ]);

    const pattern = analyzeDirection(board, 7, 7, 0, 1, "black");
    expect(pattern.count).toBe(4); // 両方向合計
    expect(pattern.end1).toBe("empty");
    expect(pattern.end2).toBe("empty");
  });

  it("片端が塞がれた三連", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" }, // 塞ぎ
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const pattern = analyzeDirection(board, 7, 6, 0, 1, "black");
    expect(pattern.count).toBe(3);
    expect(pattern.end1).toBe("empty"); // 右端は空き
    expect(pattern.end2).toBe("opponent"); // 左端は相手の石
  });
});

describe("getPatternScore", () => {
  it("五連はFIVEスコア", () => {
    const score = getPatternScore({ count: 5, end1: "empty", end2: "empty" });
    expect(score).toBe(PATTERN_SCORES.FIVE);
  });

  it("活四はOPEN_FOURスコア", () => {
    const score = getPatternScore({ count: 4, end1: "empty", end2: "empty" });
    expect(score).toBe(PATTERN_SCORES.OPEN_FOUR);
  });

  it("止め四はFOURスコア", () => {
    const score = getPatternScore({
      count: 4,
      end1: "empty",
      end2: "opponent",
    });
    expect(score).toBe(PATTERN_SCORES.FOUR);
  });

  it("両端塞がりの四は0", () => {
    const score = getPatternScore({
      count: 4,
      end1: "opponent",
      end2: "opponent",
    });
    expect(score).toBe(0);
  });

  it("活三はOPEN_THREEスコア", () => {
    const score = getPatternScore({ count: 3, end1: "empty", end2: "empty" });
    expect(score).toBe(PATTERN_SCORES.OPEN_THREE);
  });

  it("止め三はTHREEスコア", () => {
    const score = getPatternScore({ count: 3, end1: "empty", end2: "edge" });
    expect(score).toBe(PATTERN_SCORES.THREE);
  });

  it("活二はOPEN_TWOスコア", () => {
    const score = getPatternScore({ count: 2, end1: "empty", end2: "empty" });
    expect(score).toBe(PATTERN_SCORES.OPEN_TWO);
  });

  it("止め二はTWOスコア", () => {
    const score = getPatternScore({
      count: 2,
      end1: "empty",
      end2: "opponent",
    });
    expect(score).toBe(PATTERN_SCORES.TWO);
  });

  it("長連（6以上）はFIVEスコア", () => {
    const score = getPatternScore({ count: 6, end1: "empty", end2: "empty" });
    expect(score).toBe(PATTERN_SCORES.FIVE);
  });
});

describe("getPatternType", () => {
  it("五連はfive", () => {
    expect(getPatternType({ count: 5, end1: "empty", end2: "empty" })).toBe(
      "five",
    );
  });

  it("活四はopenFour", () => {
    expect(getPatternType({ count: 4, end1: "empty", end2: "empty" })).toBe(
      "openFour",
    );
  });

  it("止め四はfour", () => {
    expect(getPatternType({ count: 4, end1: "empty", end2: "opponent" })).toBe(
      "four",
    );
  });

  it("両端塞がりはnull", () => {
    expect(
      getPatternType({ count: 4, end1: "opponent", end2: "opponent" }),
    ).toBeNull();
  });
});

describe("DEFENSE_MULTIPLIERS", () => {
  it("先手脅威（five/openFour/four/openThree）は高倍率", () => {
    expect(DEFENSE_MULTIPLIERS.five).toBeGreaterThanOrEqual(0.9);
    expect(DEFENSE_MULTIPLIERS.openFour).toBeGreaterThanOrEqual(0.9);
    expect(DEFENSE_MULTIPLIERS.four).toBeGreaterThanOrEqual(0.6);
    expect(DEFENSE_MULTIPLIERS.openThree).toBeGreaterThanOrEqual(0.6);
  });

  it("構築材料（three/openTwo/two）は低倍率", () => {
    expect(DEFENSE_MULTIPLIERS.three).toBeLessThanOrEqual(0.4);
    expect(DEFENSE_MULTIPLIERS.openTwo).toBeLessThanOrEqual(0.3);
    expect(DEFENSE_MULTIPLIERS.two).toBeLessThanOrEqual(0.2);
  });

  it("倍率の順序: five >= openFour > four >= openThree > three > openTwo > two", () => {
    expect(DEFENSE_MULTIPLIERS.five).toBeGreaterThanOrEqual(
      DEFENSE_MULTIPLIERS.openFour,
    );
    expect(DEFENSE_MULTIPLIERS.openFour).toBeGreaterThan(
      DEFENSE_MULTIPLIERS.four,
    );
    expect(DEFENSE_MULTIPLIERS.four).toBeGreaterThanOrEqual(
      DEFENSE_MULTIPLIERS.openThree,
    );
    expect(DEFENSE_MULTIPLIERS.openThree).toBeGreaterThan(
      DEFENSE_MULTIPLIERS.three,
    );
    expect(DEFENSE_MULTIPLIERS.three).toBeGreaterThan(
      DEFENSE_MULTIPLIERS.openTwo,
    );
    expect(DEFENSE_MULTIPLIERS.openTwo).toBeGreaterThan(
      DEFENSE_MULTIPLIERS.two,
    );
  });
});

describe("applyDefenseMultiplier パターン別倍率", () => {
  it("パターンタイプ指定で正しい倍率が適用される", () => {
    const detail = { base: 1000, diagonalBonus: 0, final: 1000 };

    const fiveResult = applyDefenseMultiplier(detail, DEFENSE_MULTIPLIERS.five);
    const twoResult = applyDefenseMultiplier(detail, DEFENSE_MULTIPLIERS.two);

    // fiveの防御倍率 > twoの防御倍率
    expect(fiveResult.final).toBeGreaterThan(twoResult.final);
  });
});

describe("getCenterBonus", () => {
  it("中央（7,7）は最大ボーナス", () => {
    const bonus = getCenterBonus(7, 7);
    expect(bonus).toBe(PATTERN_SCORES.CENTER_BONUS);
  });

  it("角は最小ボーナス", () => {
    const bonus = getCenterBonus(0, 0);
    expect(bonus).toBe(0);
  });

  it("中央に近いほどボーナスが高い", () => {
    const center = getCenterBonus(7, 7);
    const far = getCenterBonus(7, 12);
    const corner = getCenterBonus(0, 0);

    expect(center).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(corner);
  });
});
