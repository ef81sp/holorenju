/**
 * 振り返り評価キューのテスト
 */

import { describe, expect, test } from "vitest";

import { buildReviewQueue, sortReviewQueue } from "./reviewQueue";

describe("buildReviewQueue", () => {
  // 珠型(最初の3手: index 0,1,2)はスキップされる
  const moves5 = ["H8", "I9", "F7", "G8", "I7"];

  test("珠型（最初の3手）をスキップ", () => {
    const queue = buildReviewQueue(moves5, true);
    expect(queue.every((item) => item.moveIndex >= 3)).toBe(true);
  });

  test("先手プレイヤー: 偶数indexがフル評価", () => {
    // moves5: 0=H8(skip), 1=I9(skip), 2=F7(skip), 3=G8, 4=I7
    // playerFirst=true → player moves at even indices → index 4 is player
    const queue = buildReviewQueue(moves5, true);
    expect(queue).toEqual([
      { moveIndex: 3, isLightEval: true }, // CPU手(odd=3)
      { moveIndex: 4, isLightEval: false }, // プレイヤー手(even=4)
    ]);
  });

  test("後手プレイヤー: 奇数indexがフル評価", () => {
    const queue = buildReviewQueue(moves5, false);
    expect(queue).toEqual([
      { moveIndex: 3, isLightEval: false }, // プレイヤー手(odd=3)
      { moveIndex: 4, isLightEval: true }, // CPU手(even=4)
    ]);
  });

  test("analyzeAll で全手フル評価", () => {
    const queue = buildReviewQueue(moves5, true, true);
    expect(queue.every((item) => !item.isLightEval)).toBe(true);
  });

  test("skipLastMove で最後の手をスキップ", () => {
    const queue = buildReviewQueue(moves5, true, false, true);
    expect(queue).toEqual([{ moveIndex: 3, isLightEval: true }]);
  });

  test("3手以下の棋譜は空キュー", () => {
    const queue = buildReviewQueue(["H8", "I9", "F7"], true);
    expect(queue).toEqual([]);
  });

  test("空配列は空キュー", () => {
    const queue = buildReviewQueue([], true);
    expect(queue).toEqual([]);
  });

  test("23手棋譜で正しい数の項目を生成", () => {
    const moves23 = Array.from({ length: 23 }, (_, i) => `M${i}`);
    const queue = buildReviewQueue(moves23, true);
    // 23手 - 3手(珠型) = 20手
    expect(queue).toHaveLength(20);
  });
});

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
});
