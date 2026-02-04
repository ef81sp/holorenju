/**
 * Move Ordering（候補手ソート）のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import {
  clearHistoryTable,
  createHistoryTable,
  createKillerMoves,
  getHistoryScore,
  getKillerMoves,
  recordKillerMove,
  sortMoves,
  updateHistory,
} from "./moveOrdering";
import { placeStonesOnBoard } from "./testUtils";

describe("KillerMoves", () => {
  it("初期状態は空", () => {
    const killers = createKillerMoves();
    const moves = getKillerMoves(killers, 0);
    expect(moves).toHaveLength(0);
  });

  it("Killer Moveを記録して取得できる", () => {
    const killers = createKillerMoves();
    const move = { row: 7, col: 7 };

    recordKillerMove(killers, 3, move);
    const moves = getKillerMoves(killers, 3);

    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual(move);
  });

  it("同じ深さに複数のKiller Moveを記録", () => {
    const killers = createKillerMoves();
    const move1 = { row: 7, col: 7 };
    const move2 = { row: 7, col: 8 };

    recordKillerMove(killers, 3, move1);
    recordKillerMove(killers, 3, move2);
    const moves = getKillerMoves(killers, 3);

    expect(moves).toHaveLength(2);
    // 新しい手が先頭
    expect(moves[0]).toEqual(move2);
    expect(moves[1]).toEqual(move1);
  });

  it("異なる深さは独立して管理", () => {
    const killers = createKillerMoves();
    const move1 = { row: 7, col: 7 };
    const move2 = { row: 7, col: 8 };

    recordKillerMove(killers, 2, move1);
    recordKillerMove(killers, 3, move2);

    expect(getKillerMoves(killers, 2)).toContainEqual(move1);
    expect(getKillerMoves(killers, 3)).toContainEqual(move2);
    expect(getKillerMoves(killers, 2)).not.toContainEqual(move2);
  });

  it("同じ手を再記録してもスキップ", () => {
    const killers = createKillerMoves();
    const move = { row: 7, col: 7 };

    recordKillerMove(killers, 3, move);
    recordKillerMove(killers, 3, move);
    const moves = getKillerMoves(killers, 3);

    expect(moves).toHaveLength(1);
  });

  it("深すぎる深度は無視", () => {
    const killers = createKillerMoves();
    const move = { row: 7, col: 7 };

    recordKillerMove(killers, 100, move);
    const moves = getKillerMoves(killers, 100);

    expect(moves).toHaveLength(0);
  });
});

describe("HistoryTable", () => {
  it("初期状態は全て0", () => {
    const history = createHistoryTable();
    expect(getHistoryScore(history, { row: 7, col: 7 })).toBe(0);
    expect(getHistoryScore(history, { row: 0, col: 0 })).toBe(0);
  });

  it("Historyを更新してスコア取得", () => {
    const history = createHistoryTable();
    const move = { row: 7, col: 7 };

    updateHistory(history, move, 3);
    expect(getHistoryScore(history, move)).toBe(9); // 3^2 = 9
  });

  it("複数回更新で累積", () => {
    const history = createHistoryTable();
    const move = { row: 7, col: 7 };

    updateHistory(history, move, 2); // 4
    updateHistory(history, move, 3); // 9
    expect(getHistoryScore(history, move)).toBe(13); // 4 + 9
  });

  it("クリアで初期化", () => {
    const history = createHistoryTable();
    const move = { row: 7, col: 7 };

    updateHistory(history, move, 5);
    expect(getHistoryScore(history, move)).toBe(25);

    clearHistoryTable(history);
    expect(getHistoryScore(history, move)).toBe(0);
  });
});

describe("sortMoves", () => {
  it("TT最善手が最優先", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const moves = [
      { row: 7, col: 8 },
      { row: 7, col: 6 },
      { row: 6, col: 7 },
    ];
    const ttMove = { row: 7, col: 6 };

    const sorted = sortMoves(moves, board, "black", { ttMove });
    expect(sorted[0]).toEqual(ttMove);
  });

  it("Killer Moveが高優先度", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const moves = [
      { row: 7, col: 8 },
      { row: 7, col: 6 },
      { row: 6, col: 7 },
    ];

    const killers = createKillerMoves();
    recordKillerMove(killers, 2, { row: 6, col: 7 });

    const sorted = sortMoves(moves, board, "black", {
      killers,
      depth: 2,
      useStaticEval: false,
    });

    // Killer Moveが上位に来る
    const killerIndex = sorted.findIndex((m) => m.row === 6 && m.col === 7);
    expect(killerIndex).toBeLessThan(2);
  });

  it("History Heuristicでソート", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const moves = [
      { row: 7, col: 8 },
      { row: 7, col: 6 },
      { row: 6, col: 7 },
    ];

    const history = createHistoryTable();
    updateHistory(history, { row: 7, col: 6 }, 10); // 高スコア

    const sorted = sortMoves(moves, board, "black", {
      history,
      useStaticEval: false,
    });

    // Historyスコアが高い手が上位
    const highHistoryIndex = sorted.findIndex(
      (m) => m.row === 7 && m.col === 6,
    );
    expect(highHistoryIndex).toBe(0);
  });

  it("静的評価でソート", () => {
    const board = createEmptyBoard();
    // 黒が3つ並んでいる → 4つ目を置く位置が高評価
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const moves = [
      { row: 0, col: 0 }, // 低評価
      { row: 7, col: 8 }, // 高評価（活四形成）
      { row: 7, col: 4 }, // 高評価（活四形成）
    ];

    const sorted = sortMoves(moves, board, "black", { useStaticEval: true });

    // 活四を作る位置が上位
    expect(sorted[0].row).toBe(7);
    expect([4, 8]).toContain(sorted[0].col);
  });
});
