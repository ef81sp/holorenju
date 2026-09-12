/**
 * 脅威プローブ統計（probe_calls / probe_cap_hits）の wasm 配線テスト
 * （docs/plans/bench-fixed-nodes-2026-09-06.md §7.7〜7.8）。
 *
 * stats バッファは append-only で +60 probe_calls / +64 probe_cap_hits を持ち、
 * `getStatsBufferLength()` が 68 を返す。TS リーダー（scripts/lib/wasmSearchStats.ts）は
 * その長さで存在判定する。上限到達の厳密な検証は zig/src/minimax.zig のテストで担保済み。
 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import {
  STATS_BUFFER_PROBE_STATS_BYTES,
  readWasmSearchStats,
} from "../../../../scripts/lib/wasmSearchStats";
import { boardStateToWasm } from "./boardAdapter";
import { loadWasmModule } from "./loader";

/** 序盤の戦術局面（棋譜: H8 I9 I8 G8 F6 I7 G6、白番）。深さ 7 でプローブが多数走る */
function buildTacticalBoard(): BoardState {
  const board: BoardState = [];
  for (let r = 0; r < 15; r++) {
    board.push(Array<null>(15).fill(null));
  }
  const moves: [string, "black" | "white"][] = [
    ["H8", "black"],
    ["I9", "white"],
    ["I8", "black"],
    ["G8", "white"],
    ["F6", "black"],
    ["I7", "white"],
    ["G6", "black"],
  ];
  for (const [pos, color] of moves) {
    const col = pos.charCodeAt(0) - "A".charCodeAt(0);
    const row = Number(pos.slice(1)) - 1;
    board[row]![col] = color;
  }
  return board;
}

describe("probe stats (wasm 配線)", () => {
  it("getStatsBufferLength() は 68 で、時間モードの探索で probeCalls > 0 が読める", async () => {
    const wasm = await loadWasmModule();
    expect(wasm.getStatsBufferLength?.()).toBe(STATS_BUFFER_PROBE_STATS_BYTES);

    boardStateToWasm(wasm, buildTacticalBoard());
    wasm.ttClear();
    // 白番、深さ 5、時間 1 s、ノード上限 50k（プローブは depth >= 3 で走る）
    wasm.findBestMove(2, 5, 1_000, 50_000, 0, 0, 0x1ff);

    const view = new DataView(wasm.memory.buffer);
    const stats = readWasmSearchStats(
      view,
      wasm.getStatsBuffer(),
      wasm.getSearchFeatures?.(),
      wasm.getStatsBufferLength?.(),
    );
    expect(stats.probeCalls).toBeGreaterThan(0);
    expect(stats.probeCapHits).toBeDefined();
    expect(stats.probeCapHits!).toBeLessThanOrEqual(stats.probeCalls!);
  });
});
