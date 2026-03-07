/**
 * 反復深化探索のテスト
 *
 * findBestMoveIterative、ノード数制限、絶対時間制限のテスト
 */

import { describe, expect, it, vi } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { DEFAULT_EVAL_OPTIONS } from "../evaluation";
import { placeStonesOnBoard } from "../testUtils";
import { computeBoardHash } from "../zobrist";
import { createSearchContext } from "./context";
import {
  findBestMoveIterative,
  findBestMoveIterativeWithTT,
  minimaxWithTT,
} from "./minimax";
import {
  applyTimePressureFallback,
  type DepthHistoryEntry,
  type IterativeDeepingResult,
} from "./results";
import { INFINITY } from "./techniques";

describe("findBestMoveIterative", () => {
  it("深さ1から開始して有効な手を返す", () => {
    const board = createEmptyBoard();
    const result = findBestMoveIterative(board, "black", 3, 5000);

    expect(result.position).toEqual({ row: 7, col: 7 });
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
    expect(typeof result.interrupted).toBe("boolean");
  });

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
    const result = findBestMoveIterativeWithTT({
      board,
      color: "black",
      maxDepth: 10, // 深度は深め
      timeLimit: 60000, // 時間は長め
      randomFactor: 0,
      evaluationOptions: DEFAULT_EVAL_OPTIONS,
      maxNodes: 100, // ノード数上限
    });

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
    const result = findBestMoveIterativeWithTT({
      board,
      color: "black",
      maxDepth: 2, // 浅い深度
      timeLimit: 60000,
      randomFactor: 0,
      evaluationOptions: DEFAULT_EVAL_OPTIONS,
      maxNodes: 1000000, // 大きなノード数上限
    });

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
    const result = findBestMoveIterativeWithTT({
      board,
      color: "black",
      maxDepth: 2,
      timeLimit: 10000,
      randomFactor: 0,
      evaluationOptions: DEFAULT_EVAL_OPTIONS,
    });

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
    const result = findBestMoveIterativeWithTT({
      board,
      color: "black",
      maxDepth: 20, // 深度は深め
      timeLimit: 60000, // 通常の時間制限は長め
      randomFactor: 0,
      evaluationOptions: DEFAULT_EVAL_OPTIONS,
      absoluteTimeLimit: 100, // 絶対時間制限100ms
    });
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
    const result = findBestMoveIterativeWithTT({
      board,
      color: "white",
      maxDepth: 2,
      timeLimit: 1000,
      randomFactor: 0,
      evaluationOptions: DEFAULT_EVAL_OPTIONS,
      // absoluteTimeLimit省略
    });

    // 有効な結果が返される
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
  });
});

describe("deadline ベースの時間管理", () => {
  it("deadline が過去なら timeoutFlag が立つ", () => {
    vi.useFakeTimers();
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);
    const ctx = createSearchContext();
    ctx.deadline = performance.now() - 1; // 過去
    ctx.timeoutFlag = false;
    const hash = computeBoardHash(board);
    minimaxWithTT(
      board,
      hash,
      2,
      true,
      "black",
      -INFINITY,
      INFINITY,
      null,
      ctx,
    );
    expect(ctx.timeoutFlag).toBe(true);
    vi.useRealTimers();
  });

  it("absoluteDeadline が過去なら absoluteDeadlineExceeded が立つ", () => {
    vi.useFakeTimers();
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);
    const ctx = createSearchContext();
    ctx.deadline = performance.now() + 999999;
    ctx.absoluteDeadline = performance.now() - 1; // 過去
    ctx.absoluteDeadlineExceeded = false;
    const hash = computeBoardHash(board);
    minimaxWithTT(
      board,
      hash,
      3,
      true,
      "black",
      -INFINITY,
      INFINITY,
      null,
      ctx,
    );
    expect(ctx.absoluteDeadlineExceeded).toBe(true);
    vi.useRealTimers();
  });

  it("deadline が未来なら timeoutFlag は立たない", () => {
    vi.useFakeTimers();
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);
    const ctx = createSearchContext();
    ctx.deadline = performance.now() + 999999;
    ctx.timeoutFlag = false;
    const hash = computeBoardHash(board);
    minimaxWithTT(
      board,
      hash,
      1,
      true,
      "black",
      -INFINITY,
      INFINITY,
      null,
      ctx,
    );
    expect(ctx.timeoutFlag).toBe(false);
    vi.useRealTimers();
  });

  it("deadline/absoluteDeadline は未設定", () => {
    const ctx = createSearchContext();
    expect(ctx.deadline).toBeUndefined();
    expect(ctx.absoluteDeadline).toBeUndefined();
  });
});

// =============================================================================
// applyTimePressureFallback テスト
// =============================================================================

describe("applyTimePressureFallback", () => {
  /** テスト用のベース結果を作成 */
  function makeResult(
    overrides: Partial<IterativeDeepingResult> = {},
  ): IterativeDeepingResult {
    return {
      position: { row: 5, col: 5 },
      score: 100,
      completedDepth: 3,
      interrupted: true,
      elapsedTime: 500,
      ...overrides,
    };
  }

  it("中断時にスコアが大幅低下した場合、最深の高スコアエントリを採用", () => {
    const depthHistory: DepthHistoryEntry[] = [
      { depth: 1, position: { row: 7, col: 7 }, score: 500 },
      { depth: 2, position: { row: 8, col: 8 }, score: 3000 },
    ];
    const result = makeResult({ score: 100, position: { row: 5, col: 5 } });

    const final = applyTimePressureFallback(result, depthHistory, true);

    expect(final.position).toEqual({ row: 8, col: 8 });
    expect(final.score).toBe(3000);
    expect(final.timePressureFallback).toBe(true);
    expect(final.fallbackFromDepth).toBe(2);
  });

  it("スコア低下が閾値未満の場合はフォールバックしない", () => {
    const depthHistory: DepthHistoryEntry[] = [
      { depth: 1, position: { row: 7, col: 7 }, score: 3000 },
      { depth: 2, position: { row: 8, col: 8 }, score: 3000 },
    ];
    // スコア差 = 3000 - 1600 = 1400 < 1500
    const result = makeResult({ score: 1600, position: { row: 5, col: 5 } });

    const final = applyTimePressureFallback(result, depthHistory, true);

    expect(final.position).toEqual({ row: 5, col: 5 });
    expect(final.score).toBe(1600);
    expect(final.timePressureFallback).toBeUndefined();
  });

  it("中断されていない場合はフォールバックしない", () => {
    const depthHistory: DepthHistoryEntry[] = [
      { depth: 2, position: { row: 8, col: 8 }, score: 3000 },
    ];
    const result = makeResult({
      score: 100,
      position: { row: 5, col: 5 },
      interrupted: false,
    });

    const final = applyTimePressureFallback(result, depthHistory, false);

    expect(final.position).toEqual({ row: 5, col: 5 });
    expect(final.score).toBe(100);
    expect(final.timePressureFallback).toBeUndefined();
  });

  it("depthHistoryが空の場合はフォールバックしない", () => {
    const result = makeResult({ score: 100 });

    const final = applyTimePressureFallback(result, [], true);

    expect(final.position).toEqual({ row: 5, col: 5 });
    expect(final.score).toBe(100);
    expect(final.timePressureFallback).toBeUndefined();
  });

  it("最深の高スコアエントリを優先する", () => {
    const depthHistory: DepthHistoryEntry[] = [
      { depth: 1, position: { row: 7, col: 7 }, score: 3000 },
      { depth: 2, position: { row: 8, col: 8 }, score: 3500 },
      { depth: 3, position: { row: 9, col: 9 }, score: 2800 },
    ];
    const result = makeResult({ score: 100, position: { row: 5, col: 5 } });

    const final = applyTimePressureFallback(result, depthHistory, true);

    // depth 3 のエントリ（score 2800）が最深の高スコアエントリ
    expect(final.position).toEqual({ row: 9, col: 9 });
    expect(final.score).toBe(2800);
    expect(final.fallbackFromDepth).toBe(3);
  });
});

describe("VCTメインフロー統合 - enableVCT=false", () => {
  it("enableVCT=falseではVCT探索が実行されない", () => {
    const board = createEmptyBoard();
    // 序盤の局面（14石未満）
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);
    // DEFAULT_EVAL_OPTIONS はenableVCT=false
    const result = findBestMoveIterativeWithTT({
      board,
      color: "black",
      maxDepth: 2,
      timeLimit: 2000,
      randomFactor: 0,
      evaluationOptions: DEFAULT_EVAL_OPTIONS,
    });
    // 正常に結果が返ることを確認
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
  });
});
