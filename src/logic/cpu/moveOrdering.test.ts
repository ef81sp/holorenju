/**
 * Move Ordering（候補手ソート）のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { DEFAULT_EVAL_OPTIONS } from "./evaluation";
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

  it("止め四がある場合、必須防御は四の防御位置のみ含む", () => {
    const board = createEmptyBoard();
    // 黒の止め四（行7）: D8-E8-F8-G8 + 白H8でブロック → 防御位置 C8
    // 黒の活三（行10）: E11-F11-G11（四とは完全に独立）
    placeStonesOnBoard(board, [
      // 黒の止め四: D8(row7,col3)-E8(row7,col4)-F8(row7,col5)-G8(row7,col6)
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      // 片端をブロック: H8(row7,col7)
      { row: 7, col: 7, color: "white" },
      // 黒の活三（行10）: E11(row10,col4)-F11(row10,col5)-G11(row10,col6)
      { row: 10, col: 4, color: "black" },
      { row: 10, col: 5, color: "black" },
      { row: 10, col: 6, color: "black" },
      // 白のダミー
      { row: 0, col: 0, color: "white" },
    ]);

    // C8(row7,col2)が止め四の防御位置
    // D11(row10,col3)とH11(row10,col7)が活三の防御位置（四を止めない）
    const moves = [
      { row: 7, col: 2 }, // C8: 止め四の防御位置
      { row: 10, col: 3 }, // D11: 活三の防御位置（四を止めない）
      { row: 10, col: 7 }, // H11: 活三の防御位置（四を止めない）
      { row: 3, col: 3 }, // 無関係な位置
      { row: 4, col: 4 }, // 無関係な位置
      { row: 5, col: 5 }, // 無関係な位置
    ];

    const sorted = sortMoves(moves, board, "white", {
      useStaticEval: true,
      evaluationOptions: {
        ...DEFAULT_EVAL_OPTIONS,
        enableMandatoryDefense: true,
      },
      maxStaticEvalCount: 1,
    });

    // 止め四の防御位置(C8)のみ残り、活三防御と無関係位置は除外
    const hasOpenThreeDefense = sorted.some(
      (m) => (m.row === 10 && m.col === 3) || (m.row === 10 && m.col === 7),
    );
    expect(hasOpenThreeDefense).toBe(false);

    const hasFourDefense = sorted.some((m) => m.row === 7 && m.col === 2);
    expect(hasFourDefense).toBe(true);
  });
});
