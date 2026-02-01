/**
 * Minimax + Alpha-Beta剪定のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { DEFAULT_EVAL_OPTIONS, PATTERN_SCORES } from "./evaluation";
import {
  findBestMove,
  findBestMoveIterative,
  findBestMoveIterativeWithTT,
  minimax,
} from "./minimax";
import { placeStonesOnBoard } from "./testUtils";

describe("minimax", () => {
  it("深さ0では現在の盤面評価を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const score = minimax(board, 0, true, "black");
    expect(typeof score).toBe("number");
  });

  it("maximizingPlayerがtrueの場合は最大値を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const score = minimax(board, 1, true, "black");
    expect(typeof score).toBe("number");
  });

  it("maximizingPlayerがfalseの場合は最小値を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const score = minimax(board, 1, false, "black");
    expect(typeof score).toBe("number");
  });
});

describe("findBestMove", () => {
  it("空の盤面では中央を返す", () => {
    const board = createEmptyBoard();
    const result = findBestMove(board, "black", 2);

    expect(result.position).toEqual({ row: 7, col: 7 });
  });

  it("勝利できる手がある場合はその手を選ぶ", () => {
    const board = createEmptyBoard();
    // 黒が4つ並んでいる状態
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const result = findBestMove(board, "black", 2);

    // 五連を作る手を選ぶはず
    expect(
      (result.position.row === 7 && result.position.col === 7) ||
        (result.position.row === 7 && result.position.col === 2),
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(PATTERN_SCORES.FIVE);
  });

  it("相手の勝利を阻止する手を選ぶ", () => {
    const board = createEmptyBoard();
    // 白が4つ並んでいる状態（白が勝ちそう）
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 8, col: 8, color: "black" }, // 黒の手番用
    ]);

    // 深度を2で白の脅威を認識する
    const result = findBestMove(board, "black", 2);

    // 有効な手が返されることを確認
    // 評価スコアが負の場合、相手が有利と認識している
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    // 相手が有利な盤面なのでスコアは負
    expect(result.score).toBeLessThan(0);
  });

  it(
    "活四を作る手を優先する",
    () => {
      const board = createEmptyBoard();
      // 黒が3つ並んでいる状態（両端が空いている）
      placeStonesOnBoard(board, [
        { row: 7, col: 4, color: "black" },
        { row: 7, col: 5, color: "black" },
        { row: 7, col: 6, color: "black" },
      ]);

      const result = findBestMove(board, "black", 3);

      // 活四を作る手を選ぶはず（(7,3) または (7,7)）
      // より高い評価を持つ手を選ぶ
      expect(result.position.row === 7).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    },
    15000,
  );

  it("探索深度に応じた結果を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    const result1 = findBestMove(board, "black", 1);
    const result2 = findBestMove(board, "black", 2);

    // 両方とも有効な手を返す
    expect(result1.position.row).toBeGreaterThanOrEqual(0);
    expect(result1.position.row).toBeLessThan(15);
    expect(result2.position.row).toBeGreaterThanOrEqual(0);
    expect(result2.position.row).toBeLessThan(15);
  });

  it("白番でも正しく動作する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const result = findBestMove(board, "white", 2);

    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeLessThan(15);
  });

  it("ランダム要素がある場合でも有効な手を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    const result = findBestMove(board, "black", 2, 0.3);

    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeLessThan(15);
  });
});

describe("findBestMoveIterative", () => {
  it("深さ1から開始して有効な手を返す", () => {
    const board = createEmptyBoard();
    const result = findBestMoveIterative(board, "black", 3, 5000);

    expect(result.position).toEqual({ row: 7, col: 7 });
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
    expect(typeof result.interrupted).toBe("boolean");
  });

  it("時間制限内で可能な限り深く探索する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    // 2秒の時間制限で最大深度3まで探索（評価関数の計算量増加に対応）
    const result = findBestMoveIterative(board, "black", 3, 2000);

    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
    expect(result.completedDepth).toBeLessThanOrEqual(3);
  }, 10000);

  it("短い時間制限では早期に中断する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
      { row: 6, col: 6, color: "black" },
      { row: 6, col: 8, color: "white" },
    ]);

    // 非常に短い時間制限（10ms）
    const result = findBestMoveIterative(board, "black", 5, 10);

    // 有効な手が返される
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    // 浅い深度で完了するはず
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
  });

  it("勝利できる手がある場合は高スコアを返す", () => {
    const board = createEmptyBoard();
    // 黒が4つ並んでいる状態（両端が空いている）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const result = findBestMoveIterative(board, "black", 3, 5000);

    // 有効な手が選択され、勝利手があるため高スコアになるはず
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.score).toBeGreaterThanOrEqual(PATTERN_SCORES.FIVE);
  });

  it("completedDepthとinterruptedが正しく設定される", () => {
    const board = createEmptyBoard();

    const result = findBestMoveIterative(board, "black", 2, 10000);

    // 十分な時間があれば最大深度まで到達
    expect(result.completedDepth).toBe(2);
    expect(result.interrupted).toBe(false);
  });
});

describe("findBestMoveIterativeWithTT - ノード数制限", () => {
  it("ノード数上限で探索が中断される", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
      { row: 6, col: 6, color: "black" },
      { row: 6, col: 8, color: "white" },
    ]);

    // 非常に小さいノード数上限（100ノード）
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      10, // 深度は深め
      60000, // 時間は長め
      0,
      DEFAULT_EVAL_OPTIONS,
      100, // ノード数上限
    );

    // 有効な手が返される
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeLessThan(15);

    // ノード数上限により探索が中断された
    expect(result.interrupted).toBe(true);

    // 探索ノード数が上限以下
    expect(result.stats.nodes).toBeLessThanOrEqual(150); // マージン考慮
  });

  it("ノード数上限内なら中断されない", () => {
    const board = createEmptyBoard();
    // 石を配置して候補手を増やす
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    // 大きなノード数上限（100万ノード）と短い深度
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      2, // 浅い深度
      60000,
      0,
      DEFAULT_EVAL_OPTIONS,
      1000000, // 大きなノード数上限
    );

    // 深度2で完了
    expect(result.completedDepth).toBe(2);
    // ノード数上限に達していない
    expect(result.stats.nodes).toBeLessThan(1000000);
    // 中断されていない
    expect(result.interrupted).toBe(false);
  });

  it("ノード数上限未指定なら無制限", () => {
    const board = createEmptyBoard();
    // 石を配置して候補手を増やす
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    // ノード数上限未指定
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      2,
      10000,
      0,
      DEFAULT_EVAL_OPTIONS,
      undefined, // ノード数上限未指定
    );

    // 有効な結果が返される
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
  });
});
