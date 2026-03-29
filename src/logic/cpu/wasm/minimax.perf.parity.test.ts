/**
 * Minimax パフォーマンス パリティテスト
 *
 * TS版 minimax.perf.test.ts と同じ盤面で WASM版が
 * 同等の挙動（手の選択・スコア方向性）を示すか検証する。
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

import type { SearchStats } from "../search/context";
import type { IterativeDeepingResult } from "../search/results";

import { FULL_EVAL_OPTIONS } from "../evaluation";
import { findBestMoveIterativeWithTT } from "../search/minimax";
import { createBoardWithStones, placeStonesOnBoard } from "../testUtils";
import { loadWasmModule } from "./loader";
import { WasmSearchEngine } from "./searchEngine";

/** WASM版の勝ちスコア（i16 max = 32767）。TS版の PATTERN_SCORES.FIVE (100000) に相当 */
const WASM_WIN_SCORE = 32767;

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

describe("パフォーマンス パリティ: 基本", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("活四を作る手を優先する（黒3連両端空き）", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const wasmResult = engine.findBestMoveWithParams(
      board,
      "black",
      3,
      10000,
      600000,
    );

    // row=7 の手を選ぶ（四を作る手）
    expect(wasmResult.position.row).toBe(7);
    expect(wasmResult.score).toBeGreaterThan(0);
  }, 15000);
});

describe("パフォーマンス パリティ: 即勝ち・防御の優先順位", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("相手の止め四がある局面ではVCFより防御を優先する", () => {
    // 18手目（白J9）でrow=6に白4連の止め四が成立
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 H6 J8 J6 H9 F9 H10 K7 I11 F8 J12 K13 G11 F12 J9",
    );

    const tsResult = tsSearch(board, "black", 4);
    const wasmResult = engine.findBestMoveWithParams(
      board,
      "black",
      4,
      10000,
      600000,
    );

    // K9（row=6, col=10）で止める必要がある
    expect(wasmResult.position).toEqual({ row: 6, col: 10 });
    expect(wasmResult.position).toEqual(tsResult.position);
  }, 15000);

  it("自分の四がある局面では五連完成を優先する", () => {
    const { board } = createBoardFromRecord(
      "H8 I7 G7 I9 H6 J8 H10 H9 G9 J7 H7 G8 I8 J9 J10 I10 F7 E7 G6 H5 F8 L9 K9 K8 I6 H11 F6",
    );

    const wasmResult = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      10000,
      600000,
    );

    // 白は五連を完成させるべき
    expect(wasmResult.score).toBe(WASM_WIN_SCORE);
  }, 15000);
});

describe("パフォーマンス パリティ: 相手VCF防御", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("相手にVCFがある局面で防御手を選ぶ", () => {
    // 13手目後、白番。黒にH7からの5手VCFがある。
    const { board } = createBoardFromRecord(
      "H8 G7 I7 G9 H6 F8 G6 F9 H10 G8 F7 G10 G11",
    );

    const wasmResult = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      10000,
      600000,
    );

    // D11 (row=3, col=3) は無関係な手なので選ばれるべきではない
    const isD11 =
      wasmResult.position.row === 3 && wasmResult.position.col === 3;
    expect(isD11).toBe(false);
    expect(wasmResult.position.row).toBeGreaterThanOrEqual(0);
    expect(wasmResult.position.row).toBeLessThan(15);
  }, 15000);
});

describe("パフォーマンス パリティ: VCFレース判定", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("2手以上のVCFでも相手VCFに関係なく勝利を返す", () => {
    const board = createBoardWithStones([
      // 白の横止め三
      { row: 7, col: 1, color: "white" },
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 0, color: "black" },
      // 白の縦止め三
      { row: 4, col: 5, color: "white" },
      { row: 5, col: 5, color: "white" },
      { row: 6, col: 5, color: "white" },
      { row: 3, col: 5, color: "black" },
      // 黒の活三
      { row: 10, col: 7, color: "black" },
      { row: 10, col: 8, color: "black" },
      { row: 10, col: 9, color: "black" },
    ]);

    const wasmResult = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );

    // VCFが有効なのでFIVEスコアを返すべき
    expect(wasmResult.score).toBe(WASM_WIN_SCORE);
  }, 15000);
});

describe("パフォーマンス パリティ: 非生産的四の水平線効果対策", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("棋譜37手目でG12（非生産的四）が最善手にならない", () => {
    const record =
      "H8 H9 J10 I9 G9 I8 G10 I11 I10 F10 J9 H11 G11 G8 J11 J12 I12 K10 I7 L14 K13 J8 L7 K7 L6 K5 I6 L8 K8 M6 H5 J7 K6 M9 J6 H6";
    const { board } = createBoardFromRecord(record, 36);

    const wasmResult = engine.findBestMoveWithParams(
      board,
      "black",
      4,
      5000,
      600000,
    );

    // G12 = (row=3, col=6) が最善手でないことを検証
    const isG12 =
      wasmResult.position.row === 3 && wasmResult.position.col === 6;
    expect(isG12).toBe(false);
  }, 30000);
});
