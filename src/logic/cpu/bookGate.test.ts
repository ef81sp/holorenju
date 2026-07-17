/**
 * cpu.worker.ts のオープニングブック適用条件（opening-book-2026-07-16.md §2）のテスト。
 *
 * self.onmessage を使う cpu.worker.ts 自体は node 環境で直接 import できない
 * （Worker グローバルスコープ前提）ため、適用条件の判定ロジックだけを
 * このテスト可能な純粋関数に切り出している。
 */
import { describe, expect, it } from "vitest";

import {
  BOOK_ENABLED_DIFFICULTIES,
  isBookEligible,
  isWithinBookRange,
} from "./bookGate";

describe("BOOK_ENABLED_DIFFICULTIES", () => {
  it("hard のみが対象（DifficultyParams型は変更しない専用定数）", () => {
    expect(BOOK_ENABLED_DIFFICULTIES).toEqual(["hard"]);
  });
});

describe("isBookEligible", () => {
  it.each([3, 5, 7])(
    "hard・白番・moveCount=%i（ply4/6/8）は true",
    (moveCount) => {
      expect(isBookEligible("hard", "white", moveCount)).toBe(true);
    },
  );

  it.each([4, 6])("hard・黒番・moveCount=%i（ply5/7）は true", (moveCount) => {
    expect(isBookEligible("hard", "black", moveCount)).toBe(true);
  });

  it.each(["beginner", "easy", "medium"] as const)(
    "%s（hard以外）は白番でも false",
    (difficulty) => {
      expect(isBookEligible(difficulty, "white", 3)).toBe(false);
    },
  );

  it.each(["beginner", "easy", "medium"] as const)(
    "%s（hard以外）は黒番でも false",
    (difficulty) => {
      expect(isBookEligible(difficulty, "black", 4)).toBe(false);
    },
  );

  it("hard・黒番でもレンジ外（moveCount3/7）は false（黒は4〜6の範囲のみ）", () => {
    expect(isBookEligible("hard", "black", 3)).toBe(false);
    expect(isBookEligible("hard", "black", 7)).toBe(false);
  });

  it("hard・白番でも ply4未満（moveCount<3）は false（opening.ts の領域）", () => {
    expect(isBookEligible("hard", "white", 1)).toBe(false);
  });

  it("hard・白番でも ply8超（moveCount>7）は false", () => {
    expect(isBookEligible("hard", "white", 8)).toBe(false);
    expect(isBookEligible("hard", "white", 9)).toBe(false);
  });

  it("hard・黒番でも ply5未満/ply7超は false", () => {
    expect(isBookEligible("hard", "black", 2)).toBe(false);
    expect(isBookEligible("hard", "black", 8)).toBe(false);
  });
});

describe("isWithinBookRange", () => {
  it.each([3, 5, 7])(
    "白番・moveCount=%i（ply4/6/8）は true（難易度に依存しない）",
    (mc) => {
      expect(isWithinBookRange("white", mc)).toBe(true);
    },
  );

  it.each([4, 6])("黒番・moveCount=%i（ply5/7）は true", (mc) => {
    expect(isWithinBookRange("black", mc)).toBe(true);
  });

  it("黒番はレンジ外（moveCount3/7）では false", () => {
    expect(isWithinBookRange("black", 3)).toBe(false);
    expect(isWithinBookRange("black", 7)).toBe(false);
  });

  it("白番は黒のレンジ（moveCount4/6）では true（白のレンジにも含まれるため）", () => {
    // 白のレンジは3〜7なので4/6も含まれる。黒固有ではないことの確認。
    expect(isWithinBookRange("white", 4)).toBe(true);
    expect(isWithinBookRange("white", 6)).toBe(true);
  });

  it("範囲外（白: moveCount<3 or >7、黒: moveCount<4 or >6）は false", () => {
    expect(isWithinBookRange("white", 2)).toBe(false);
    expect(isWithinBookRange("white", 8)).toBe(false);
    expect(isWithinBookRange("black", 3)).toBe(false);
    expect(isWithinBookRange("black", 7)).toBe(false);
  });
});
