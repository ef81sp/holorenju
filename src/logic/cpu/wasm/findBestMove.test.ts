/* eslint-disable no-bitwise -- WASM packed return values require bitwise ops */

/**
 * findBestMove WASM パリティテスト
 *
 * WASM版 findBestMove が有効な手を返すことを確認する。
 */

import { describe, expect, it } from "vitest";

import { createBoardWithStones } from "../testUtils";
import { loadWasmModule } from "./loader";
import { WasmSearchEngine } from "./searchEngine";

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

  it("五連が作れる盤面で勝ち手を返す", () => {
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

    const result = engine.findBestMoveWithParams(board, "black", 1, 1000, 5000);

    // 五連完成手のいずれか: (7,3) or (7,8)
    const isWinningMove =
      (result.position.row === 7 && result.position.col === 3) ||
      (result.position.row === 7 && result.position.col === 8);
    expect(isWinningMove).toBe(true);
    // スコアは五連相当（高いスコア）
    expect(result.score).toBeGreaterThan(10000);
  });

  it("白番で五連が作れる盤面で勝ち手を返す", () => {
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

    const result = engine.findBestMoveWithParams(board, "white", 1, 1000, 5000);

    const isWinningMove =
      (result.position.row === 5 && result.position.col === 4) ||
      (result.position.row === 5 && result.position.col === 9);
    expect(isWinningMove).toBe(true);
    expect(result.score).toBeGreaterThan(10000);
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
