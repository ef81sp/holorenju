import { describe, expect, it } from "vitest";

import type { Position } from "@/types/game";

import {
  listChebyshevNeighbors,
  selectMoveWithRandomization,
} from "./randomization";

const BEST: Position = { row: 7, col: 7 };
const FALLBACK: Position = { row: 3, col: 3 };

describe("selectMoveWithRandomization", () => {
  it("randomFactor が 0 のときは pickRandomMove を呼ばず bestMove を返す", () => {
    let called = false;
    const got = selectMoveWithRandomization({
      bestMove: BEST,
      randomFactor: 0,
      random: () => 0,
      pickRandomMove: () => {
        called = true;
        return FALLBACK;
      },
    });
    expect(got).toEqual(BEST);
    expect(called).toBe(false);
  });

  it("random() >= randomFactor のときは bestMove を返す", () => {
    const got = selectMoveWithRandomization({
      bestMove: BEST,
      randomFactor: 0.4,
      random: () => 0.4,
      pickRandomMove: () => FALLBACK,
    });
    expect(got).toEqual(BEST);
  });

  it("random() < randomFactor のときは pickRandomMove の結果を返す", () => {
    const got = selectMoveWithRandomization({
      bestMove: BEST,
      randomFactor: 0.4,
      random: () => 0.1,
      pickRandomMove: () => FALLBACK,
    });
    expect(got).toEqual(FALLBACK);
  });

  it("pickRandomMove が null を返したら bestMove にフォールバックする", () => {
    const got = selectMoveWithRandomization({
      bestMove: BEST,
      randomFactor: 1,
      random: () => 0,
      pickRandomMove: () => null,
    });
    expect(got).toEqual(BEST);
  });

  describe("criticalScoreThreshold", () => {
    it("|score| が閾値以上ならランダム化をスキップする（活三以上の脅威は見逃さない）", () => {
      const got = selectMoveWithRandomization({
        bestMove: BEST,
        bestMoveScore: 1200,
        criticalScoreThreshold: 800,
        randomFactor: 1,
        random: () => 0,
        pickRandomMove: () => FALLBACK,
      });
      expect(got).toEqual(BEST);
    });

    it("|score| が閾値未満なら通常のランダム化が効く", () => {
      const got = selectMoveWithRandomization({
        bestMove: BEST,
        bestMoveScore: 100,
        criticalScoreThreshold: 800,
        randomFactor: 1,
        random: () => 0,
        pickRandomMove: () => FALLBACK,
      });
      expect(got).toEqual(FALLBACK);
    });

    it("負の大きいスコア（自分が劣勢）でもスキップする", () => {
      const got = selectMoveWithRandomization({
        bestMove: BEST,
        bestMoveScore: -1500,
        criticalScoreThreshold: 800,
        randomFactor: 1,
        random: () => 0,
        pickRandomMove: () => FALLBACK,
      });
      expect(got).toEqual(BEST);
    });

    it("threshold 未設定なら従来通り（Lv1 = 脅威も見逃す）", () => {
      const got = selectMoveWithRandomization({
        bestMove: BEST,
        bestMoveScore: 10000,
        randomFactor: 1,
        random: () => 0,
        pickRandomMove: () => FALLBACK,
      });
      expect(got).toEqual(FALLBACK);
    });
  });
});

describe("listChebyshevNeighbors", () => {
  it("中央(7,7)の半径1は8マス（中心を除く）", () => {
    const got = listChebyshevNeighbors({ row: 7, col: 7 }, 1);
    expect(got).toHaveLength(8);
    expect(got).not.toContainEqual({ row: 7, col: 7 });
    expect(got).toContainEqual({ row: 6, col: 7 });
    expect(got).toContainEqual({ row: 8, col: 8 });
  });

  it("中央(7,7)の半径2は24マス（5x5 - 1）", () => {
    const got = listChebyshevNeighbors({ row: 7, col: 7 }, 2);
    expect(got).toHaveLength(24);
  });

  it("中央(7,7)の半径3は48マス（7x7 - 1）", () => {
    const got = listChebyshevNeighbors({ row: 7, col: 7 }, 3);
    expect(got).toHaveLength(48);
  });

  it("盤端(0,0)では盤外を含まない", () => {
    const got = listChebyshevNeighbors({ row: 0, col: 0 }, 2);
    // 3x3 - 1 = 8
    expect(got).toHaveLength(8);
    expect(got.every((p) => p.row >= 0 && p.col >= 0)).toBe(true);
  });

  it("盤端(14,14)では盤外を含まない", () => {
    const got = listChebyshevNeighbors({ row: 14, col: 14 }, 2);
    expect(got).toHaveLength(8);
    expect(got.every((p) => p.row < 15 && p.col < 15)).toBe(true);
  });

  it("半径0は空配列", () => {
    expect(listChebyshevNeighbors({ row: 7, col: 7 }, 0)).toEqual([]);
  });
});
