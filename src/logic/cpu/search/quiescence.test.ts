/**
 * Quiescence Search のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { evaluateBoard } from "../evaluation/boardEvaluation";
import { FULL_EVAL_OPTIONS, PATTERN_SCORES } from "../evaluation/patternScores";
import { placeStonesOnBoard } from "../testUtils";
import { computeBoardHash } from "../zobrist";
import { createSearchContext } from "./context";
import {
  generateTacticalMoves,
  MAX_QUIESCENCE_DEPTH,
  quiescenceSearch,
} from "./quiescence";

function createBoard(
  stones: { row: number; col: number; color: "black" | "white" }[],
): ReturnType<typeof createEmptyBoard> {
  const board = createEmptyBoard();
  placeStonesOnBoard(board, stones);
  return board;
}

describe("generateTacticalMoves", () => {
  it("四を作れる手がなければ空配列を返す", () => {
    // 散在した石のみ
    const board = createBoard([
      { row: 7, col: 7, color: "black" },
      { row: 0, col: 0, color: "white" },
    ]);
    const moves = generateTacticalMoves(board, "black", null);
    expect(moves).toEqual([]);
  });

  it("四を作れる手を列挙する", () => {
    // 黒3連 (7,5)(7,6)(7,7) → (7,4) or (7,8) で四
    const board = createBoard([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 0, col: 0, color: "white" },
    ]);
    const moves = generateTacticalMoves(board, "black", null);
    expect(moves.length).toBeGreaterThan(0);
    // (7,4) か (7,8) が含まれるはず
    const hasExpected = moves.some(
      (m) => (m.row === 7 && m.col === 4) || (m.row === 7 && m.col === 8),
    );
    expect(hasExpected).toBe(true);
  });

  it("相手の止め四に対してブロック手のみを返す", () => {
    // 白が盤端で止め四: (7,0)(7,1)(7,2) + lastMove=(7,3)
    // → (7,0)(7,1)(7,2)(7,3) 白4連、片端盤端 → (7,4) でブロック
    const board = createBoard([
      { row: 7, col: 0, color: "white" },
      { row: 7, col: 1, color: "white" },
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "white" },
      { row: 0, col: 14, color: "black" },
    ]);
    // 黒の手番、lastMove は白の (7,3)
    const moves = generateTacticalMoves(board, "black", { row: 7, col: 3 });
    expect(moves.length).toBe(1);
    expect(moves[0]).toEqual({ row: 7, col: 4 });
  });
});

describe("quiescenceSearch", () => {
  it("静止状態（四なし）ではstand-patを返す", () => {
    // 散在した石のみ（四の脅威なし）
    const board = createBoard([
      { row: 7, col: 7, color: "black" },
      { row: 0, col: 0, color: "white" },
    ]);
    const hash = computeBoardHash(board);
    const ctx = createSearchContext(undefined, FULL_EVAL_OPTIONS);

    const standPat = evaluateBoard(board, "black", {
      singleFourPenaltyMultiplier:
        FULL_EVAL_OPTIONS.singleFourPenaltyMultiplier,
      lastMoverIsPerspective: false,
    });

    const qScore = quiescenceSearch(
      board,
      hash,
      true,
      "black",
      -PATTERN_SCORES.FIVE,
      PATTERN_SCORES.FIVE,
      null,
      ctx,
      MAX_QUIESCENCE_DEPTH,
    );

    // 脅威手がないのでstand-patと同じ
    expect(qScore).toBe(standPat);
  });

  it("四がある局面で静止探索がスコアを補正する", () => {
    // 白3連 (0,0)(1,0)(2,0): (3,0) で四を作れる
    // 白の手番で四を打ち、黒がブロック → 四の脅威が解決される
    const board = createBoard([
      { row: 0, col: 0, color: "white" },
      { row: 1, col: 0, color: "white" },
      { row: 2, col: 0, color: "white" },
      // 黒ダミー
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 7, color: "black" },
    ]);
    const hash = computeBoardHash(board);
    const ctx = createSearchContext(undefined, FULL_EVAL_OPTIONS);

    const standPat = evaluateBoard(board, "black", {
      singleFourPenaltyMultiplier:
        FULL_EVAL_OPTIONS.singleFourPenaltyMultiplier,
      lastMoverIsPerspective: true, // 白の手番 → isMaximizing=false
    });

    // 白手番（isMaximizing=false）で探索
    const qScore = quiescenceSearch(
      board,
      hash,
      false, // 白の手番
      "black",
      -PATTERN_SCORES.FIVE,
      PATTERN_SCORES.FIVE,
      null,
      ctx,
      MAX_QUIESCENCE_DEPTH,
    );

    // 白が四を作れる手があるので、quiescence は stand-pat だけでなく
    // 追加ノードを探索する（nodes > 1）
    expect(ctx.stats.nodes).toBeGreaterThan(1);
    // スコアは stand-pat 以下（白が四を打って有利になれるなら下がる）
    // ただし alpha-beta cutoff により stand-pat と同じ場合もある
    expect(qScore).toBeLessThanOrEqual(standPat);
  });
});
