/**
 * 反復深化探索のテスト
 *
 * findBestMoveIterative、ノード数制限、絶対時間制限のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { DEFAULT_EVAL_OPTIONS, PATTERN_SCORES } from "../evaluation";
import { placeStonesOnBoard } from "../testUtils";
import { findBestMoveIterative, findBestMoveIterativeWithTT } from "./minimax";

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

describe("findBestMoveIterativeWithTT - 絶対時間制限", () => {
  it("絶対時間制限で探索が中断される", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
      { row: 6, col: 6, color: "black" },
      { row: 6, col: 8, color: "white" },
    ]);

    // 短い絶対時間制限（100ms）
    const startTime = performance.now();
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      20, // 深度は深め
      60000, // 通常の時間制限は長め
      0,
      DEFAULT_EVAL_OPTIONS,
      undefined, // ノード数上限なし
      100, // 絶対時間制限100ms
    );
    const elapsed = performance.now() - startTime;

    // 有効な手が返される
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);

    // 絶対時間制限内で終了している（マージン考慮）
    expect(elapsed).toBeLessThan(200);

    // 探索が中断された
    expect(result.interrupted).toBe(true);
  });

  it("絶対時間制限がデフォルト値（10秒）で動作する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    // 絶対時間制限を指定しない（デフォルト10秒）
    const result = findBestMoveIterativeWithTT(
      board,
      "white",
      2,
      1000,
      0,
      DEFAULT_EVAL_OPTIONS,
      undefined,
      // absoluteTimeLimit省略
    );

    // 有効な結果が返される
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
  });
});
