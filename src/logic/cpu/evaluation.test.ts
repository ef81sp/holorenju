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
  evaluateStonePatternsWithBreakdown,
  PATTERN_SCORES,
} from "./evaluation";
import { applyPatternScoreOverrides } from "./evaluation/patternScores";
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

describe("evaluateStonePatternsWithBreakdown activeDirectionCount", () => {
  it("孤立した石は activeDirectionCount = 0", () => {
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    const result = evaluateStonePatternsWithBreakdown(board, 7, 7, "black");
    expect(result.activeDirectionCount).toBe(0);
  });

  it("横方向のみにパターンがある石は activeDirectionCount = 1", () => {
    const board = createBoardWithStones([
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // (7,7)は横方向にのみ活二パターン
    const result = evaluateStonePatternsWithBreakdown(board, 7, 7, "black");
    expect(result.activeDirectionCount).toBe(1);
  });

  it("横方向と縦方向にパターンがある石は activeDirectionCount = 2", () => {
    const board = createBoardWithStones([
      { row: 7, col: 6, color: "black" }, // 横方向
      { row: 7, col: 7, color: "black" }, // 交差点
      { row: 6, col: 7, color: "black" }, // 縦方向
    ]);
    const result = evaluateStonePatternsWithBreakdown(board, 7, 7, "black");
    expect(result.activeDirectionCount).toBe(2);
  });

  it("3方向にパターンがある石は activeDirectionCount = 3", () => {
    const board = createBoardWithStones([
      { row: 7, col: 6, color: "black" }, // 横方向
      { row: 7, col: 7, color: "black" }, // 交差点
      { row: 6, col: 7, color: "black" }, // 縦方向
      { row: 6, col: 6, color: "black" }, // 右下斜め方向（7,7から見て左上）
    ]);
    const result = evaluateStonePatternsWithBreakdown(board, 7, 7, "black");
    expect(result.activeDirectionCount).toBe(3);
  });

  it("4方向全てにパターンがある石は activeDirectionCount = 4", () => {
    const board = createBoardWithStones([
      { row: 7, col: 6, color: "black" }, // 横方向
      { row: 7, col: 7, color: "black" }, // 交差点
      { row: 6, col: 7, color: "black" }, // 縦方向
      { row: 6, col: 6, color: "black" }, // 右下斜め方向
      { row: 6, col: 8, color: "black" }, // 右上斜め方向
    ]);
    const result = evaluateStonePatternsWithBreakdown(board, 7, 7, "black");
    expect(result.activeDirectionCount).toBe(4);
  });
});

describe("evaluateBoard 連携ボーナス", () => {
  it("2方向にパターンがある石は1方向のみの石より高評価", () => {
    // Board A: 横方向のみの活二（2石とも1方向）
    const boardA = createBoardWithStones([
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    // Board B: 交差点を持つ配置（(7,7)が2方向にパターン）
    const boardB = createBoardWithStones([
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    const scoreA = evaluateBoard(boardA, "black");
    const scoreB = evaluateBoard(boardB, "black");

    // Board Bは連携ボーナスにより、単にパターンスコアが増えた以上に高い
    // Board Bのベース = 活二(50)*2方向 + 活二(50)*1方向 = 150
    // Board Aのベース = 活二(50)*1方向 = 50 (各石は1方向)
    // 連携ボーナスにより Board B はさらに加点
    expect(scoreB).toBeGreaterThan(scoreA);
  });

  it("連携ボーナスは connectivityBonusValue で制御できる", () => {
    const board = createBoardWithStones([
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    const scoreDefault = evaluateBoard(board, "black");
    const scoreNoBonus = evaluateBoard(board, "black", {
      connectivityBonusValue: 0,
    });

    // ボーナス0の場合より、デフォルトのほうが高い
    expect(scoreDefault).toBeGreaterThan(scoreNoBonus);
  });
});

describe("evaluateBoard 四三脅威スキャン", () => {
  it("Test A: 四三機会ありで bonus 加算", () => {
    // 黒: 横3連 (7,5)(7,6)(7,7) + 縦2連 (6,8)(8,8)
    // → 空き (7,8) で四(横) + 活三(縦) = 四三
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 6, col: 8, color: "black" },
      { row: 8, col: 8, color: "black" },
      // 白ダミー
      { row: 10, col: 10, color: "white" },
      { row: 10, col: 11, color: "white" },
    ]);

    // (8,8) を除去 → 四三不可能
    const boardNoThreat = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 6, col: 8, color: "black" },
      // 白ダミー
      { row: 10, col: 10, color: "white" },
      { row: 10, col: 11, color: "white" },
    ]);

    const scoreWith = evaluateBoard(board, "black");
    const scoreWithout = evaluateBoard(boardNoThreat, "black");

    // 差分が LEAF_FOUR_THREE_THREAT 以上（(8,8) のパターン差も含む）
    expect(scoreWith - scoreWithout).toBeGreaterThanOrEqual(
      PATTERN_SCORES.LEAF_FOUR_THREE_THREAT,
    );
  });

  it("Test B: 四三機会なしで bonus なし", () => {
    // 散在した石のみ（四三不可能）
    const board = createBoardWithStones([
      { row: 0, col: 0, color: "black" },
      { row: 14, col: 14, color: "black" },
      { row: 0, col: 14, color: "white" },
      { row: 14, col: 0, color: "white" },
    ]);

    // LEAF_FOUR_THREE_THREAT を0にした場合と差がない
    const saved = PATTERN_SCORES.LEAF_FOUR_THREE_THREAT;
    const scoreDefault = evaluateBoard(board, "black");
    applyPatternScoreOverrides({ LEAF_FOUR_THREE_THREAT: 0 });
    const scoreDisabled = evaluateBoard(board, "black");
    applyPatternScoreOverrides({ LEAF_FOUR_THREE_THREAT: saved });

    expect(scoreDefault).toBe(scoreDisabled);
  });

  it("Test C: 相手側の四三機会で opponentScore に加算", () => {
    // 白のみ四三機会あり: 横3連 + 縦2連
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 8, col: 8, color: "white" },
      // 黒ダミー（四三不可能な散在）
      { row: 0, col: 0, color: "black" },
      { row: 14, col: 14, color: "black" },
    ]);

    // 白から見ると有利（正）、黒から見ると不利（負）
    const blackScore = evaluateBoard(board, "black");
    const whiteScore = evaluateBoard(board, "white");
    expect(blackScore).toBeLessThan(0);
    expect(whiteScore).toBeGreaterThan(0);

    // 四三脅威を無効化した場合と比較
    const saved = PATTERN_SCORES.LEAF_FOUR_THREE_THREAT;
    applyPatternScoreOverrides({ LEAF_FOUR_THREE_THREAT: 0 });
    const blackScoreNoThreat = evaluateBoard(board, "black");
    applyPatternScoreOverrides({ LEAF_FOUR_THREE_THREAT: saved });

    // 白の四三脅威分、黒から見たスコアが下がっている
    expect(blackScore).toBeLessThan(blackScoreNoThreat);
  });

  it("Test D: 盤面不変性", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 6, col: 8, color: "black" },
      { row: 8, col: 8, color: "black" },
      { row: 10, col: 10, color: "white" },
      { row: 10, col: 11, color: "white" },
    ]);
    const snapshot = copyBoard(board);

    evaluateBoard(board, "black");

    expect(board).toEqual(snapshot);
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
      enableDoubleThreeThreat: false,
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
      enableDoubleThreeThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    expect(board).toEqual(snapshot);
  });
});
