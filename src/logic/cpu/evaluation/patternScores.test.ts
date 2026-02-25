/**
 * パターンスコア定数のテスト
 */

import { describe, expect, it } from "vitest";

import { PATTERN_SCORES } from "./patternScores";

describe("PATTERN_SCORES", () => {
  it("スコア定数が正しく定義されている", () => {
    expect(PATTERN_SCORES.FIVE).toBe(100000);
    expect(PATTERN_SCORES.OPEN_FOUR).toBe(10000);
    expect(PATTERN_SCORES.FOUR_THREE_BONUS).toBe(5000);
    expect(PATTERN_SCORES.FOUR).toBe(1500);
    expect(PATTERN_SCORES.OPEN_THREE).toBe(1000);
    expect(PATTERN_SCORES.THREE).toBe(30);
    expect(PATTERN_SCORES.OPEN_TWO).toBe(50);
    expect(PATTERN_SCORES.TWO).toBe(10);
    expect(PATTERN_SCORES.CENTER_BONUS).toBe(5);
    expect(PATTERN_SCORES.FORBIDDEN_TRAP).toBe(100);
  });

  it("新しいスコア定数が正しく定義されている", () => {
    expect(PATTERN_SCORES.FORBIDDEN_TRAP_STRONG).toBe(5000);
    expect(PATTERN_SCORES.FUKUMI_BONUS).toBe(1500);
    expect(PATTERN_SCORES.FORBIDDEN_TRAP_SETUP).toBe(1500);
    expect(PATTERN_SCORES.MISE_BONUS).toBe(1000);
  });

  it("高度な戦術評価のスコア定数が正しく定義されている", () => {
    expect(PATTERN_SCORES.MULTI_THREAT_BONUS).toBe(500);
    expect(PATTERN_SCORES.VCT_BONUS).toBe(8000);
    expect(PATTERN_SCORES.COUNTER_FOUR_MULTIPLIER).toBe(1.5);
  });

  it("禁手追い込み三のスコア定数が正しく定義されている", () => {
    expect(PATTERN_SCORES.FORBIDDEN_TRAP_THREE).toBe(3000);
  });

  it("止め四は活三より高スコア（絶対先手 > 相対先手）", () => {
    expect(PATTERN_SCORES.FOUR).toBeGreaterThan(PATTERN_SCORES.OPEN_THREE);
  });

  it("パターン連携ボーナスが定義されている", () => {
    expect(PATTERN_SCORES.CONNECTIVITY_BONUS).toBe(30);
  });

  it("末端四三脅威ボーナスはスコア安定性のため 2000 に設定", () => {
    expect(PATTERN_SCORES.LEAF_FOUR_THREE_THREAT).toBe(2000);
  });

  it("テンポ補正割引率が 0.5 に設定されている", () => {
    expect(PATTERN_SCORES.TEMPO_OPEN_THREE_DISCOUNT).toBe(0.5);
  });
});
