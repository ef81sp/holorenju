/**
 * 探索コンテキスト管理のテスト
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_EVAL_OPTIONS, FULL_EVAL_OPTIONS } from "../evaluation";
import { TranspositionTable } from "../transpositionTable";
import { createSearchContext } from "./context";

describe("createSearchContext", () => {
  it("デフォルト値で作成", () => {
    const ctx = createSearchContext();

    expect(ctx.tt).toBeDefined();
    expect(ctx.history).toBeDefined();
    expect(ctx.killers).toBeDefined();
    expect(ctx.stats).toEqual({
      nodes: 0,
      ttHits: 0,
      ttCutoffs: 0,
      betaCutoffs: 0,
      forbiddenCheckCalls: 0,
      boardCopies: 0,
      threatDetectionCalls: 0,
      evaluationCalls: 0,
    });
    expect(ctx.evaluationOptions).toEqual(DEFAULT_EVAL_OPTIONS);
  });

  it("カスタムTTで作成", () => {
    const customTT = new TranspositionTable(1000);
    const ctx = createSearchContext(customTT);

    expect(ctx.tt).toBe(customTT);
  });

  it("カスタム評価オプションで作成", () => {
    const ctx = createSearchContext(undefined, FULL_EVAL_OPTIONS);

    expect(ctx.evaluationOptions).toEqual(FULL_EVAL_OPTIONS);
    expect(ctx.evaluationOptions.enableFukumi).toBe(true);
    expect(ctx.evaluationOptions.enableVCT).toBe(true);
  });

  it("History Tableは初期化されている", () => {
    const ctx = createSearchContext();

    // 全ての位置が0
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 15; col++) {
        expect(ctx.history[row]?.[col]).toBe(0);
      }
    }
  });

  it("Killer Movesは初期化されている", () => {
    const ctx = createSearchContext();

    // 各深度のKiller Movesは空
    for (let depth = 0; depth < 10; depth++) {
      const moves = ctx.killers.moves[depth];
      expect(moves).toBeDefined();
      expect(moves?.every((m) => m === null)).toBe(true);
    }
  });

  it("時間制限フラグは未設定", () => {
    const ctx = createSearchContext();

    expect(ctx.startTime).toBeUndefined();
    expect(ctx.timeLimit).toBeUndefined();
    expect(ctx.timeoutFlag).toBeUndefined();
    expect(ctx.maxNodes).toBeUndefined();
    expect(ctx.nodeCountExceeded).toBeUndefined();
  });
});
