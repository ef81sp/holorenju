/**
 * 脅威検出パリティテスト
 *
 * WASM版に detectOpponentThreats の直接APIはないため、
 * findBestMove 経由で脅威検出が正しく機能しているか間接検証する。
 *
 * - 止め四に対して防御手を選ぶか
 * - 活四に対して適切なスコアを返すか
 * - ミセ手（四三）に対して防御するか
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { createBoardWithStones, placeStonesOnBoard } from "../testUtils";
import { loadWasmModule } from "./loader";
import { WasmSearchEngine } from "./searchEngine";

/** WASM版の勝ちスコア（i16 max = 32767）。TS版の PATTERN_SCORES.FIVE (100000) に相当 */
const WASM_WIN_SCORE = 32767;

describe("脅威検出パリティ: 止め四への防御", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("横の止め四（盤端）を防御する手を選ぶ", () => {
    // 黒の止め四: 盤端 col=0,1,2,3 → 白は col=4 で止める
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 0, color: "black" },
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
      { row: 7, col: 3, color: "black" },
      { row: 5, col: 5, color: "white" }, // 白の手番用
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      2,
      5000,
      600000,
    );

    // (7,4) で止め四を防御
    expect(result.position).toEqual({ row: 7, col: 4 });
  });

  it("横の止め四（相手石ブロック）を防御する手を選ぶ", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" }, // 白で片端ブロック
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      2,
      5000,
      600000,
    );

    // (7,8) で止め四を防御
    expect(result.position).toEqual({ row: 7, col: 8 });
  });

  it("斜めの止め四を防御する手を選ぶ", () => {
    const board = createBoardWithStones([
      { row: 3, col: 3, color: "black" },
      { row: 4, col: 4, color: "black" },
      { row: 5, col: 5, color: "black" },
      { row: 6, col: 6, color: "black" },
      { row: 2, col: 2, color: "white" }, // 片端ブロック
      { row: 10, col: 10, color: "white" }, // 白の手番用
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      2,
      5000,
      600000,
    );

    // (7,7) で止め四を防御
    expect(result.position).toEqual({ row: 7, col: 7 });
  });
});

describe("脅威検出パリティ: 活四（防御不能）", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("相手の活四がある場合、スコアが大きく負になる", () => {
    // 黒の活四（両端空き = 防御不能）
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 5, col: 5, color: "white" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      2,
      5000,
      600000,
    );

    // 活四は防御不能なので白のスコアは大きく負
    // 活四は防御不能なので白のスコアは大きく負（WASM i16 では -32768 付近）
    expect(result.score).toBeLessThan(-10000);
  });
});

describe("脅威検出パリティ: ミセ手（四三）", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("四三が作れる位置がある局面で脅威を認識する", () => {
    const board = createEmptyBoard();
    // (7,7)に置くと横に四、縦に活三ができる = 四三
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    // 黒番: 四三のミセ手 (7,7) を選ぶべき
    const resultBlack = engine.findBestMoveWithParams(
      board,
      "black",
      4,
      5000,
      600000,
    );
    expect(resultBlack.score).toBe(WASM_WIN_SCORE);

    // 白番: 脅威を認識してスコアが負
    const resultWhite = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );
    expect(resultWhite.score).toBeLessThan(0);
  });

  it("跳び四の脅威を正しく認識する", () => {
    // 跳び四: ●●・●● の形
    const board = createBoardWithStones([
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      // col:5 空き
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 5, col: 5, color: "white" },
    ]);

    // 白番: 跳び四に対して (7,5) で防御
    const result = engine.findBestMoveWithParams(
      board,
      "white",
      2,
      5000,
      600000,
    );
    expect(result.position).toEqual({ row: 7, col: 5 });
  });
});

describe("脅威検出パリティ: 複合脅威", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("2方向の脅威がある局面で適切に対応する", () => {
    const board = createEmptyBoard();
    // 横に黒の活三
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 斜めに黒の活三
    placeStonesOnBoard(board, [
      { row: 5, col: 9, color: "black" },
      { row: 6, col: 8, color: "black" },
      // (7,7) は共通点
    ]);
    // 白の石
    placeStonesOnBoard(board, [
      { row: 3, col: 3, color: "white" },
      { row: 4, col: 3, color: "white" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );

    // 有効な手を返す（盤面内）
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    // 黒が大幅有利なのでスコアは負
    expect(result.score).toBeLessThan(0);
  });
});
