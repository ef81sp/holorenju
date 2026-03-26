/**
 * useReviewEvaluator のユーティリティテスト
 */

import { describe, expect, test } from "vitest";

import { sortReviewQueue } from "./useReviewEvaluator";

describe("sortReviewQueue", () => {
  test("フル評価が軽量評価より先にディスパッチされる", () => {
    const items = [
      { moveIndex: 1, isLightEval: true },
      { moveIndex: 2, isLightEval: false },
      { moveIndex: 3, isLightEval: true },
      { moveIndex: 4, isLightEval: false },
    ];
    sortReviewQueue(items);
    expect(items[0]!.isLightEval).toBe(false);
    expect(items[1]!.isLightEval).toBe(false);
    expect(items[2]!.isLightEval).toBe(true);
    expect(items[3]!.isLightEval).toBe(true);
  });

  test("同じカテゴリ内の順序は安定", () => {
    const items = [
      { moveIndex: 1, isLightEval: false },
      { moveIndex: 2, isLightEval: false },
      { moveIndex: 3, isLightEval: false },
    ];
    sortReviewQueue(items);
    expect(items[0]!.moveIndex).toBe(1);
    expect(items[1]!.moveIndex).toBe(2);
    expect(items[2]!.moveIndex).toBe(3);
  });

  test("空配列でもエラーにならない", () => {
    const items: { isLightEval: boolean }[] = [];
    expect(() => sortReviewQueue(items)).not.toThrow();
  });

  test("全てフル評価なら順序不変", () => {
    const items = [
      { moveIndex: 5, isLightEval: false },
      { moveIndex: 3, isLightEval: false },
    ];
    sortReviewQueue(items);
    expect(items[0]!.moveIndex).toBe(5);
    expect(items[1]!.moveIndex).toBe(3);
  });
});
