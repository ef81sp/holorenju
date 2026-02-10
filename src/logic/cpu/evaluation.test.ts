/**
 * 盤面評価関数のテスト
 *
 * 基本的なパターン評価と盤面評価のテスト
 * 詳細なテストは各サブモジュールのテストファイルを参照:
 * - evaluation/patternScores.test.ts - スコア定数テスト
 * - evaluation/threatDetection.test.ts - 脅威検出テスト
 * - evaluation/tactics.test.ts - 戦術評価テスト
 * - evaluation/jumpPatterns.test.ts - 跳びパターンテスト
 */

import { describe, expect, it } from "vitest";

import { copyBoard, createEmptyBoard } from "@/logic/renjuRules";

import {
  evaluateBoard,
  evaluatePosition,
  evaluateStonePatterns,
  PATTERN_SCORES,
} from "./evaluation";
import { createBoardWithStones, placeStonesOnBoard } from "./testUtils";

describe("evaluateStonePatterns", () => {
  it("単独の石は0スコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);
    const score = evaluateStonePatterns(board, 7, 7, "black");
    expect(score).toBe(0);
  });

  it("2連（活二）のスコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 横方向で2連（両端空き）= OPEN_TWO
    const score = evaluateStonePatterns(board, 7, 7, "black");
    expect(score).toBe(PATTERN_SCORES.OPEN_TWO);
  });

  it("3連（活三）のスコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 横方向で3連（両端空き）= OPEN_THREE
    const score = evaluateStonePatterns(board, 7, 6, "black");
    expect(score).toBe(PATTERN_SCORES.OPEN_THREE);
  });

  it("4連（活四）のスコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 横方向で4連（両端空き）= OPEN_FOUR
    const score = evaluateStonePatterns(board, 7, 5, "black");
    expect(score).toBe(PATTERN_SCORES.OPEN_FOUR);
  });

  it("5連（五連）のスコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 横方向で5連 = FIVE
    const score = evaluateStonePatterns(board, 7, 5, "black");
    expect(score).toBe(PATTERN_SCORES.FIVE);
  });

  it("止め三（片端塞がり）のスコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 0, color: "black" }, // 盤端
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
    ]);
    // 横方向で3連（片端盤端）= THREE
    const score = evaluateStonePatterns(board, 7, 1, "black");
    expect(score).toBe(PATTERN_SCORES.THREE);
  });

  it("止め四（片端塞がり）のスコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 0, color: "black" }, // 盤端
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
      { row: 7, col: 3, color: "black" },
    ]);
    // 横方向で4連（片端盤端）= FOUR
    const score = evaluateStonePatterns(board, 7, 2, "black");
    expect(score).toBe(PATTERN_SCORES.FOUR);
  });
});

describe("evaluatePosition", () => {
  it("空の盤面の中央への着手は中央ボーナスを得る", () => {
    const board = createEmptyBoard();
    const score = evaluatePosition(board, 7, 7, "black");
    expect(score).toBeGreaterThan(0);
  });

  it("隅への着手は中央ボーナスを得られない", () => {
    const board = createEmptyBoard();
    const centerScore = evaluatePosition(board, 7, 7, "black");
    const cornerScore = evaluatePosition(board, 0, 0, "black");
    expect(centerScore).toBeGreaterThan(cornerScore);
  });

  it("五連形成は最高スコアを得る", () => {
    const board = createEmptyBoard();
    // 黒石を4つ並べる
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 5つ目を置く位置を評価
    const score = evaluatePosition(board, 7, 7, "black");
    expect(score).toBe(PATTERN_SCORES.FIVE);
  });

  it("活四形成は高スコアを得る", () => {
    const board = createEmptyBoard();
    // 黒石を3つ並べる（両端が空いている）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 4つ目を置く位置を評価（両端が空いている）
    const score = evaluatePosition(board, 7, 7, "black");
    expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.OPEN_FOUR);
  });

  it("活三形成は中程度のスコアを得る", () => {
    const board = createEmptyBoard();
    // 黒石を2つ並べる（両端が空いている）
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 3つ目を置く位置を評価
    const score = evaluatePosition(board, 7, 7, "black");
    expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.OPEN_THREE);
  });

  it("相手の脅威をブロックする手は防御スコアを得る", () => {
    const board = createEmptyBoard();
    // 白石を3つ並べる（活三）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    // 黒が7,7に置く（白の活四形成をブロック）
    const blockScore = evaluatePosition(board, 7, 7, "black");
    // 黒が別の位置に置く
    const otherScore = evaluatePosition(board, 0, 0, "black");

    // ブロックする手のほうが高スコア
    expect(blockScore).toBeGreaterThan(otherScore);
  });
});

describe("evaluateBoard", () => {
  it("空の盤面は0スコア", () => {
    const board = createEmptyBoard();
    const score = evaluateBoard(board, "black");
    expect(score).toBe(0);
  });

  it("黒の視点で黒が有利な盤面は正のスコア", () => {
    const board = createEmptyBoard();
    // 黒の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const score = evaluateBoard(board, "black");
    expect(score).toBeGreaterThan(0);
  });

  it("黒の視点で白が有利な盤面は負のスコア", () => {
    const board = createEmptyBoard();
    // 白の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    const score = evaluateBoard(board, "black");
    expect(score).toBeLessThan(0);
  });

  it("白の視点では評価が反転する", () => {
    const board = createEmptyBoard();
    // 白の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    const blackScore = evaluateBoard(board, "black");
    const whiteScore = evaluateBoard(board, "white");
    expect(whiteScore).toBeGreaterThan(0);
    expect(blackScore).toBeLessThan(0);
  });

  it("五連がある場合は非常に高いスコア", () => {
    const board = createEmptyBoard();
    // 黒の五連を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const score = evaluateBoard(board, "black");
    expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.FIVE);
  });
});

describe("evaluatePosition 盤面不変性", () => {
  it("呼び出し前後で盤面が変化しない（基本評価）", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);
    const snapshot = copyBoard(board);

    evaluatePosition(board, 7, 7, "black");

    expect(board).toEqual(snapshot);
  });

  it("呼び出し前後で盤面が変化しない（全機能有効）", () => {
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 5, col: 7, color: "white" },
      { row: 6, col: 7, color: "white" },
    ]);
    const snapshot = copyBoard(board);

    evaluatePosition(board, 7, 7, "black", {
      enableFukumi: false,
      enableMise: true,
      enableForbiddenTrap: true,
      enableMultiThreat: true,
      enableCounterFour: true,
      enableVCT: false,
      enableMandatoryDefense: true,
      enableSingleFourPenalty: true,
      singleFourPenaltyMultiplier: 0.0,
      enableMiseThreat: true,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    expect(board).toEqual(snapshot);
  });

  it("呼び出し前後で盤面が変化しない（白番禁手追い込み）", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    const snapshot = copyBoard(board);

    evaluatePosition(board, 7, 8, "white", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: true,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    expect(board).toEqual(snapshot);
  });
});
