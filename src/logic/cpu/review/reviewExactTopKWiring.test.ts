/**
 * 振り返り exact_top_k 配線テスト（review-multipv-2026-09-06.md §3-6）
 *
 * - findBestMoveForReview は wasm findBestMove の末尾 3 引数
 *   (exact_top_k, forced_row, forced_col) に既定で (5, 255, 255) を渡す。
 * - findBestMoveWithParams 系（対戦 CPU / プローブ）は末尾引数を渡さない
 *   （wasm 側で 0 = 従来どおり）。
 * - result_buffer[68] の exact_mask を読み、候補 i に scoreExact を付ける。
 *
 * wasm はモック（WebAssembly.Memory + DataView）で、実機 ABI には依存しない。
 */

import { describe, expect, it, vi } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import type { WasmModuleContext } from "../wasm/types";

import {
  REVIEW_EXACT_TOP_K,
  WasmSearchEngine,
  WASM_NO_FORCED_MOVE,
} from "../wasm/searchEngine";

const RESULT_PTR = 1024;
const PV_PTR = 4096;

interface MockCandidate {
  row: number;
  col: number;
  score: number;
}

function createMockWasm(
  candidates: MockCandidate[],
  exactMask: number,
): WasmModuleContext {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const view = new DataView(memory.buffer);
  const best = candidates[0] ?? { row: 7, col: 7, score: 0 };
  view.setUint8(RESULT_PTR, best.row);
  view.setUint8(RESULT_PTR + 1, best.col);
  view.setInt32(RESULT_PTR + 2, best.score, true);
  view.setUint8(RESULT_PTR + 6, 8);
  view.setUint8(RESULT_PTR + 7, candidates.length);
  candidates.forEach((c, i) => {
    const base = RESULT_PTR + 8 + i * 6;
    view.setUint8(base, c.row);
    view.setUint8(base + 1, c.col);
    view.setInt32(base + 2, c.score, true);
  });
  view.setUint8(RESULT_PTR + 68, exactMask);
  // PV バッファは長さ 0
  view.setUint8(PV_PTR, 0);

  return {
    memory,
    boardInit: vi.fn(),
    boardSet: vi.fn(),
    findBestMove: vi.fn(),
    getResultBuffer: () => RESULT_PTR,
    ttClear: vi.fn(),
    extractPV: vi.fn(),
    getResultPVBuffer: () => PV_PTR,
  } as unknown as WasmModuleContext;
}

const THREE_CANDIDATES: MockCandidate[] = [
  { row: 7, col: 7, score: 300 },
  { row: 7, col: 8, score: 120 },
  { row: 8, col: 8, score: 120 },
];

describe("findBestMoveForReview の exact_top_k 配線（§3-6）", () => {
  it("既定で exact_top_k=5、強制手なし(255,255) を wasm に渡す", () => {
    const wasm = createMockWasm(THREE_CANDIDATES, 0);
    const engine = new WasmSearchEngine(wasm);
    engine.findBestMoveForReview(
      createEmptyBoard(),
      "black",
      8,
      5000,
      2_000_000,
      0,
      1,
      0,
    );
    const [call] = vi.mocked(wasm.findBestMove).mock.calls;
    expect(call).toBeDefined();
    expect(call?.slice(7)).toEqual([
      REVIEW_EXACT_TOP_K,
      WASM_NO_FORCED_MOVE,
      WASM_NO_FORCED_MOVE,
    ]);
    expect(REVIEW_EXACT_TOP_K).toBe(5);
    expect(WASM_NO_FORCED_MOVE).toBe(255);
  });

  it("forcedMove を渡すと forced_row/forced_col に座標が入る", () => {
    const wasm = createMockWasm(THREE_CANDIDATES, 0);
    const engine = new WasmSearchEngine(wasm);
    engine.findBestMoveForReview(
      createEmptyBoard(),
      "black",
      8,
      5000,
      2_000_000,
      0,
      1,
      0,
      5,
      { row: 3, col: 11 },
    );
    const [call] = vi.mocked(wasm.findBestMove).mock.calls;
    expect(call?.slice(7)).toEqual([5, 3, 11]);
  });

  it("findBestMoveWithParams 系は末尾 3 引数を渡さない（0 = 従来どおり）", () => {
    const wasm = createMockWasm(THREE_CANDIDATES, 0);
    const engine = new WasmSearchEngine(wasm);
    engine.findBestMoveWithParams(createEmptyBoard(), "black", 8, 1000, 1000);
    engine.findBestMoveWithParamsNoTTClear(
      createEmptyBoard(),
      "black",
      3,
      1000,
      1000,
    );
    for (const call of vi.mocked(wasm.findBestMove).mock.calls) {
      expect(call.length).toBe(7);
    }
  });
});

describe("result_buffer[68] exact_mask の読み取り（§3-6）", () => {
  it("bit i が立った候補 i に scoreExact=true、それ以外は false", () => {
    // 候補 0 と 2 が真値
    const wasm = createMockWasm(THREE_CANDIDATES, 0b101);
    const engine = new WasmSearchEngine(wasm);
    const result = engine.findBestMoveForReview(
      createEmptyBoard(),
      "black",
      8,
      5000,
      2_000_000,
      0,
      1,
      0,
    );
    expect(result.candidates.map((c) => c.scoreExact)).toEqual([
      true,
      false,
      true,
    ]);
    expect(result.candidates.map((c) => c.score)).toEqual([300, 120, 120]);
  });

  it("旧 wasm（mask=0）では全候補 scoreExact=false", () => {
    const wasm = createMockWasm(THREE_CANDIDATES, 0);
    const engine = new WasmSearchEngine(wasm);
    const result = engine.findBestMoveForReview(
      createEmptyBoard(),
      "black",
      8,
      5000,
      2_000_000,
      0,
      1,
      0,
    );
    expect(result.candidates.every((c) => c.scoreExact === false)).toBe(true);
  });

  it("6 件目の候補（強制候補）も bit 5 で読める", () => {
    const six: MockCandidate[] = [
      ...THREE_CANDIDATES,
      { row: 9, col: 9, score: 50 },
      { row: 9, col: 10, score: 40 },
      { row: 3, col: 11, score: -200 },
    ];
    const wasm = createMockWasm(six, 0b100000);
    const engine = new WasmSearchEngine(wasm);
    const result = engine.findBestMoveForReview(
      createEmptyBoard(),
      "black",
      8,
      5000,
      2_000_000,
      0,
      1,
      0,
    );
    expect(result.candidates).toHaveLength(6);
    expect(result.candidates[5]?.scoreExact).toBe(true);
    expect(result.candidates[4]?.scoreExact).toBe(false);
  });
});
