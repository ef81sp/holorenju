/**
 * Gate 0 計測基盤のスモークテスト（docs/plans/eval-basis-prospect-2026-07-13.md §5）
 *
 * threatProbe 実行時トグルと aspiration 再探索カウンタの export が正しく配線され、
 * 呼び出せることを確認する。厳密な「probe 有効時に必ず cutoff が発生する」ことの
 * 検証は zig/src/minimax.zig の直接 minimaxWithTT 呼び出しテスト（preSearch を経由
 * しないため cutoff を確実に発火させられる）で担保済み。本テストは wasm export の
 * 配線確認に留める。
 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import type { WasmModuleContext } from "./types";

import { boardStateToWasm } from "./boardAdapter";
import { loadWasmModule } from "./loader";

function emptyBoard(): BoardState {
  const board: BoardState = [];
  for (let r = 0; r < 15; r++) {
    board.push(Array<null>(15).fill(null));
  }
  return board;
}

/** 死四を4本持つ局面（即詰み・即勝ち手なし、evalOptionsWiring と同一構成） */
function buildFourHeavyBoard(): BoardState {
  const board = emptyBoard();
  board[7]![4] = "black";
  board[7]![5] = "black";
  board[7]![6] = "black";
  board[7]![7] = "black";
  board[7]![3] = "white";
  board[7]![8] = "white";

  board[4]![12] = "black";
  board[5]![12] = "black";
  board[6]![12] = "black";
  board[7]![12] = "black";
  board[3]![12] = "white";
  board[8]![12] = "white";

  board[1]![4] = "white";
  board[1]![5] = "white";
  board[1]![6] = "white";
  board[1]![7] = "white";
  board[1]![3] = "black";
  board[1]![8] = "black";

  board[4]![2] = "white";
  board[5]![2] = "white";
  board[6]![2] = "white";
  board[7]![2] = "white";
  board[3]![2] = "black";
  board[8]![2] = "black";

  return board;
}

/* eslint-disable no-bitwise -- 統計バッファのバイトオフセット計算 */
function readThreatProbeCutoffs(wasm: WasmModuleContext): number {
  const ptr = wasm.getStatsBuffer();
  const view = new DataView(wasm.memory.buffer);
  // main.zig writeStats: 12フィールド×u32、threat_probe_cutoffs は12番目(index11)
  return view.getUint32(ptr + 11 * 4, true);
}
/* eslint-enable no-bitwise */

describe("setThreatProbeEnabled: 探索へのトグルが配線されている", () => {
  it("setThreatProbeEnabled(0) の後は threat_probe_cutoffs が常に0になる", async () => {
    const wasm = await loadWasmModule();
    const board = buildFourHeavyBoard();
    boardStateToWasm(wasm, board);

    wasm.ttClear();
    wasm.setThreatProbeEnabled(0);
    wasm.findBestMove(1, 6, 0, 5000, 0, 0, 0);

    expect(readThreatProbeCutoffs(wasm)).toBe(0);

    // 既定値に戻す（同一 wasm インスタンスを使う後続処理への影響を避ける）
    wasm.setThreatProbeEnabled(1);
  });

  it("setThreatProbeEnabled(1)（既定）でも探索は正常に完了する", async () => {
    const wasm = await loadWasmModule();
    const board = buildFourHeavyBoard();
    boardStateToWasm(wasm, board);

    wasm.ttClear();
    wasm.setThreatProbeEnabled(1);
    wasm.findBestMove(1, 6, 0, 5000, 0, 0, 0);

    const ptr = wasm.getResultBuffer();
    const view = new DataView(wasm.memory.buffer);
    const row = view.getUint8(ptr);
    const col = view.getUint8(ptr + 1);
    expect(row).toBeLessThan(15);
    expect(col).toBeLessThan(15);
  });
});

describe("getAspirationResearchCount: 探索へのカウンタが配線されている", () => {
  it("findBestMove 後に呼び出せて非負の数値を返す", async () => {
    const wasm = await loadWasmModule();
    const board = buildFourHeavyBoard();
    boardStateToWasm(wasm, board);

    wasm.ttClear();
    wasm.findBestMove(1, 4, 0, 20000, 2000, 1, 0); // aspirationMode=1で複数幅を試す

    const count = wasm.getAspirationResearchCount();
    expect(count).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(count)).toBe(true);
  });

  it("2回連続で呼んでも累積しない（findBestMoveごとにリセットされる）", async () => {
    const wasm = await loadWasmModule();
    const board = buildFourHeavyBoard();
    boardStateToWasm(wasm, board);

    wasm.ttClear();
    wasm.findBestMove(1, 4, 0, 20000, 2000, 1, 0);
    const first = wasm.getAspirationResearchCount();

    wasm.ttClear();
    wasm.findBestMove(1, 4, 0, 20000, 2000, 1, 0);
    const second = wasm.getAspirationResearchCount();

    expect(second).toBe(first);
  });
});
