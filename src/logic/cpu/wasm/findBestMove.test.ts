/**
 * findBestMove WASM パリティテスト
 *
 * WASM版 findBestMove が有効な手を返すことを確認する。
 * 一部テストではTS版 findBestMoveIterativeWithTT と手の一致を検証。
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import type { SearchStats } from "../search/context";
import type { IterativeDeepingResult } from "../search/results";

import { FULL_EVAL_OPTIONS } from "../evaluation";
import { findBestMoveIterativeWithTT } from "../search/minimax";
import { createBoardWithStones } from "../testUtils";
import { loadWasmModule } from "./loader";
import { WasmSearchEngine } from "./searchEngine";

/**
 * 勝ちスコアの閾値。WASM版は現在 i32 スコアで TS版と同じスケール（FIVE=100000）を使用。
 * 深さオフセットがあるため 99000 以上を勝ちスコアとみなす。
 */
const WIN_SCORE_THRESHOLD = 99000;

/** TS版探索のヘルパー */
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

describe("findBestMove WASM tests", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("空に近い盤面で有効な手を返す", () => {
    const board = createBoardWithStones([
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    const result = engine.findBestMoveWithParams(board, "black", 2, 2000, 5000);

    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeLessThan(15);
    // 既に石が置いてある位置ではないこと
    const isOccupied =
      (result.position.row === 7 && result.position.col === 7) ||
      (result.position.row === 7 && result.position.col === 8);
    expect(isOccupied).toBe(false);
  });

  it("五連が作れる盤面で勝ち手を返し、TS版と一致", () => {
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      // 白の石（防御なし）
      { row: 3, col: 3, color: "white" },
      { row: 3, col: 4, color: "white" },
      { row: 3, col: 5, color: "white" },
    ]);

    const tsResult = tsSearch(board, "black", 1);
    const result = engine.findBestMoveWithParams(board, "black", 1, 1000, 5000);

    // TS版と同じ手を選ぶ
    expect(result.position).toEqual(tsResult.position);
    // スコアは五連相当
    expect(result.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
  });

  it("白番で五連が作れる盤面で勝ち手を返し、TS版と一致", () => {
    const board = createBoardWithStones([
      { row: 5, col: 5, color: "white" },
      { row: 5, col: 6, color: "white" },
      { row: 5, col: 7, color: "white" },
      { row: 5, col: 8, color: "white" },
      // 黒の石
      { row: 3, col: 3, color: "black" },
      { row: 3, col: 4, color: "black" },
      { row: 3, col: 5, color: "black" },
      { row: 3, col: 6, color: "black" },
    ]);

    const tsResult = tsSearch(board, "white", 1);
    const result = engine.findBestMoveWithParams(board, "white", 1, 1000, 5000);

    // TS版と同じ手を選ぶ
    expect(result.position).toEqual(tsResult.position);
    expect(result.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
  });

  it("16手目白番でJ9（活四による即勝ち）を選ぶ", () => {
    // H8 G9 G8 F8 H10 F9 H9 H11 G10 I10 I8 F11 J8 K8 F12
    const board = createBoardWithStones([
      { row: 7, col: 7, color: "black" },
      { row: 6, col: 6, color: "white" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 5, color: "white" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 5, color: "white" },
      { row: 6, col: 7, color: "black" },
      { row: 4, col: 7, color: "white" },
      { row: 5, col: 6, color: "black" },
      { row: 5, col: 8, color: "white" },
      { row: 7, col: 8, color: "black" },
      { row: 4, col: 5, color: "white" },
      { row: 7, col: 9, color: "black" },
      { row: 7, col: 10, color: "white" },
      { row: 3, col: 5, color: "black" },
    ]);

    // J9 (row=6, col=9) creates an open four on diagonal (4,7)-(5,8)-(6,9)-(7,10)
    const tsResult = tsSearch(board, "white", 4);
    const result = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );
    // TS版と同じ手を選ぶ
    expect(result.position).toEqual(tsResult.position);
    expect(result.position.row).toBe(6);
    expect(result.position.col).toBe(9);
    expect(result.score).toBeGreaterThan(10000);
  });

  it("18手目白番で黒の斜め活三を止める", () => {
    // 17手目まで: 黒が H11-I10-J9 の斜め活三を形成
    const board = createBoardWithStones([
      { row: 7, col: 7, color: "black" },
      { row: 6, col: 8, color: "white" },
      { row: 7, col: 8, color: "black" },
      { row: 7, col: 9, color: "white" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "white" },
      { row: 6, col: 6, color: "black" },
      { row: 7, col: 6, color: "white" },
      { row: 5, col: 5, color: "black" },
      { row: 4, col: 4, color: "white" },
      { row: 5, col: 8, color: "black" },
      { row: 5, col: 6, color: "white" },
      { row: 6, col: 9, color: "black" },
      { row: 8, col: 8, color: "white" },
      { row: 4, col: 8, color: "black" },
      { row: 3, col: 9, color: "white" },
      { row: 4, col: 7, color: "black" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      8000,
      600000,
    );
    // G12(3,6) or K8(7,10) のどちらかで三を止める
    const isDefense =
      (result.position.row === 3 && result.position.col === 6) ||
      (result.position.row === 7 && result.position.col === 10);
    expect(isDefense).toBe(true);
  });

  it("difficulty パラメータで探索できる", () => {
    const board = createBoardWithStones([
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    const result = engine.findBestMove(board, "black", "beginner");

    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeLessThan(15);
  });
});
