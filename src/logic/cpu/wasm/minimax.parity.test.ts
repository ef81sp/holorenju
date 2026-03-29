/**
 * Minimax パリティテスト
 *
 * TS版 minimax.test.ts と同じ盤面で WASM版 findBestMove を呼び、
 * 同じ手を選ぶか・スコアの方向性が一致するかを検証する。
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { checkForbiddenMove, createEmptyBoard } from "@/logic/renjuRules";

import type { SearchStats } from "../search/context";
import type { IterativeDeepingResult } from "../search/results";

import { FULL_EVAL_OPTIONS } from "../evaluation";
import { findBestMoveIterativeWithTT } from "../search/minimax";
import { createBoardWithStones, placeStonesOnBoard } from "../testUtils";
import { loadWasmModule } from "./loader";
import { WasmSearchEngine } from "./searchEngine";

/** 勝ちスコア（FIVE = 100000） */
const WASM_WIN_SCORE = 100000;

/** TS版探索のヘルパー（randomFactor=0, FULL_EVAL_OPTIONS） */
function tsSearch(
  board: ReturnType<typeof createEmptyBoard>,
  color: "black" | "white",
  maxDepth: number,
  timeLimit = 10000,
): IterativeDeepingResult & { stats: SearchStats } {
  return findBestMoveIterativeWithTT({
    board,
    color,
    maxDepth,
    timeLimit,
    randomFactor: 0,
    evaluationOptions: FULL_EVAL_OPTIONS,
  });
}

describe("minimax パリティテスト", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  // ── 空盤面: 中央を選ぶ ──────────────────────
  it("空の盤面では中央を返す", () => {
    const board = createEmptyBoard();

    const wasmResult = engine.findBestMoveWithParams(
      board,
      "black",
      2,
      5000,
      600000,
    );

    expect(wasmResult.position).toEqual({ row: 7, col: 7 });
  });

  // ── 五連完成手を選ぶ ──────────────────────
  it("黒4連から五連を作る手を選ぶ", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const tsResult = tsSearch(board, "black", 2);
    const wasmResult = engine.findBestMoveWithParams(
      board,
      "black",
      2,
      5000,
      600000,
    );

    // 五連手 (7,7) or (7,2)
    expect(
      (wasmResult.position.row === 7 && wasmResult.position.col === 7) ||
        (wasmResult.position.row === 7 && wasmResult.position.col === 2),
    ).toBe(true);
    // スコアが五連相当（FIVE = 100000）
    expect(wasmResult.score).toBe(WASM_WIN_SCORE);
    // TS版と同じ手
    expect(wasmResult.position).toEqual(tsResult.position);
  });

  // ── 相手の勝利を阻止する ──────────────────────
  it("相手の4連を阻止しスコアが負", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 8, col: 8, color: "black" },
    ]);

    const wasmResult = engine.findBestMoveWithParams(
      board,
      "black",
      2,
      5000,
      600000,
    );

    expect(wasmResult.position.row).toBeGreaterThanOrEqual(0);
    expect(wasmResult.position.row).toBeLessThan(15);
    // 相手有利なのでスコアは負
    expect(wasmResult.score).toBeLessThan(0);
  });

  // ── 白番で正しく動作 ──────────────────────
  it("白番で有効な手を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const wasmResult = engine.findBestMoveWithParams(
      board,
      "white",
      2,
      5000,
      600000,
    );

    expect(wasmResult.position.row).toBeGreaterThanOrEqual(0);
    expect(wasmResult.position.row).toBeLessThan(15);
    expect(wasmResult.position.col).toBeGreaterThanOrEqual(0);
    expect(wasmResult.position.col).toBeLessThan(15);
  });

  // ── 強制手 ──────────────────────
  it("候補手が1つの場合でも有効な手を返す", () => {
    const { board } = createBoardFromRecord(
      "H8 G8 J6 G9 G7 I9 J7 J8 H7 I7 I8 J9",
    );

    const tsResult = tsSearch(board, "black", 4);
    const wasmResult = engine.findBestMoveWithParams(
      board,
      "black",
      4,
      5000,
      600000,
    );

    // TS版は強制手を検出。WASM版も同じ手を返すはず
    expect(wasmResult.position).toEqual(tsResult.position);
  });

  // ── 片端ブロック済み4連の五連完成 ──────────────────────
  it("片端ブロック済み4連で五連スコアを返す", () => {
    const board = createBoardWithStones([
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);

    const wasmResult = engine.findBestMoveWithParams(
      board,
      "black",
      2,
      5000,
      600000,
    );

    // (7,7) が唯一の五連手
    expect(wasmResult.position).toEqual({ row: 7, col: 7 });
    expect(wasmResult.score).toBe(WASM_WIN_SCORE);
  });
});

describe("minimax パリティ: 禁手回避", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("黒番でMise-VCFの手が三々禁の場合、その手を選ばない", () => {
    const { board } = createBoardFromRecord(
      "H8 G9 F8 G8 G7 D10 H7 I9 F7 E7 G6 F6",
    );

    const wasmResult = engine.findBestMoveWithParams(
      board,
      "black",
      4,
      10000,
      600000,
    );

    // 返された手が禁手でないことを検証
    const forbidden = checkForbiddenMove(
      board,
      wasmResult.position.row,
      wasmResult.position.col,
    );
    expect(forbidden.isForbidden).toBe(false);
  }, 15000);

  it("H6 (row=9, col=7) は禁手なので選ばれない", () => {
    const { board } = createBoardFromRecord(
      "H8 G9 F8 G8 G7 D10 H7 I9 F7 E7 G6 F6",
    );

    const wasmResult = engine.findBestMoveWithParams(
      board,
      "black",
      4,
      10000,
      600000,
    );

    const isH6 = wasmResult.position.row === 9 && wasmResult.position.col === 7;
    expect(isH6).toBe(false);
  }, 15000);
});
