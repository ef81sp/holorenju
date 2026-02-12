import { describe, expect, it } from "vitest";

import type { EvaluatedMove } from "@/types/review";

import {
  OPENING_MOVES,
  buildGameReview,
  classifyMoveQuality,
  isOpeningMove,
} from "./reviewLogic";

describe("classifyMoveQuality", () => {
  it("スコア差0は最善手", () => {
    expect(classifyMoveQuality(0)).toBe("excellent");
  });

  it("スコア差1は好手（最善手ではない）", () => {
    expect(classifyMoveQuality(1)).toBe("good");
  });

  it("スコア差80は好手", () => {
    expect(classifyMoveQuality(80)).toBe("good");
  });

  it("スコア差81は疑問手", () => {
    expect(classifyMoveQuality(81)).toBe("inaccuracy");
  });

  it("スコア差300は疑問手", () => {
    expect(classifyMoveQuality(300)).toBe("inaccuracy");
  });

  it("スコア差301は悪手", () => {
    expect(classifyMoveQuality(301)).toBe("mistake");
  });

  it("スコア差1000は悪手", () => {
    expect(classifyMoveQuality(1000)).toBe("mistake");
  });

  it("スコア差1001は大悪手", () => {
    expect(classifyMoveQuality(1001)).toBe("blunder");
  });

  it("負のスコア差でも絶対値で判定", () => {
    expect(classifyMoveQuality(-80)).toBe("good");
    expect(classifyMoveQuality(-300)).toBe("inaccuracy");
  });
});

describe("isOpeningMove", () => {
  it("珠型の3手（0,1,2）は開局手", () => {
    expect(isOpeningMove(0)).toBe(true);
    expect(isOpeningMove(1)).toBe(true);
    expect(isOpeningMove(2)).toBe(true);
  });

  it("4手目以降は開局手ではない", () => {
    expect(isOpeningMove(3)).toBe(false);
    expect(isOpeningMove(10)).toBe(false);
  });

  it("OPENING_MOVESは3", () => {
    expect(OPENING_MOVES).toBe(3);
  });
});

describe("buildGameReview", () => {
  function makeMove(
    isPlayerMove: boolean,
    quality: EvaluatedMove["quality"],
  ): EvaluatedMove {
    return {
      moveIndex: 0,
      position: { row: 7, col: 7 },
      isPlayerMove,
      quality,
      playedScore: 0,
      bestScore: 0,
      scoreDiff: 0,
      bestMove: { row: 7, col: 7 },
      candidates: [],
    };
  }

  it("精度はプレイヤーのexcellent+goodの割合", () => {
    const moves = [
      makeMove(true, "excellent"),
      makeMove(true, "good"),
      makeMove(true, "inaccuracy"),
      makeMove(true, "mistake"),
    ];
    const review = buildGameReview(moves);
    expect(review.accuracy).toBe(50);
  });

  it("相手の手は精度計算に含めない", () => {
    const moves = [
      makeMove(true, "excellent"),
      makeMove(false, "blunder"),
      makeMove(true, "good"),
      makeMove(false, "blunder"),
    ];
    const review = buildGameReview(moves);
    expect(review.accuracy).toBe(100);
  });

  it("クリティカルエラーはmistake+blunderの数", () => {
    const moves = [
      makeMove(true, "mistake"),
      makeMove(true, "blunder"),
      makeMove(true, "inaccuracy"),
    ];
    const review = buildGameReview(moves);
    expect(review.criticalErrors).toBe(2);
  });

  it("プレイヤーの手がない場合は精度100", () => {
    const moves = [makeMove(false, "blunder")];
    const review = buildGameReview(moves);
    expect(review.accuracy).toBe(100);
  });
});
