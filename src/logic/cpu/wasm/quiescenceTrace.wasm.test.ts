/**
 * 静止探索の診断トレース（`quiescenceTraceWasm` / `WasmSearchEngine.quiescenceTrace`）の
 * 配線テスト。PV と stand-pat の整合（PV を置いて static eval と一致）は
 * zig/src/quiescence.zig の "q_trace:" テストで担保済み。ここではバッファの読み出し形状
 * （pv と standPats の長さ関係・cut の文字列化）を確認する。
 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { loadWasmModule } from "./loader";
import { WasmSearchEngine } from "./searchEngine";

function emptyBoard(): BoardState {
  const board: BoardState = [];
  for (let r = 0; r < 15; r++) {
    board.push(Array<null>(15).fill(null));
  }
  return board;
}

/**
 * 黒番。四の応酬が 1 往復ある局面（zig/src/quiescence.zig の同名テストと同じ配置）。
 * - 黒 横 (7,3)(7,4)(7,5)（左端 (7,2) 白）→ (7,6) で止め四（斜め (5,4)(6,5) で同時に活三）
 * - 白 縦 (8,7)(9,7)(10,7)（上端 (11,7) 黒）→ 受け (7,7) が白の止め四 → 黒 (6,7) で受け返す
 * 静止探索の PV は (7,6) (7,7) (6,7) の 3 手。
 */
function buildFourExchangeBoard(): BoardState {
  const board = emptyBoard();
  board[7]![2] = "white";
  board[7]![3] = "black";
  board[7]![4] = "black";
  board[7]![5] = "black";
  board[5]![4] = "black";
  board[6]![5] = "black";
  board[8]![7] = "white";
  board[9]![7] = "white";
  board[10]![7] = "white";
  board[11]![7] = "black";
  return board;
}

describe("quiescenceTrace (wasm)", () => {
  const enginePromise = loadWasmModule().then(
    (wasm) => new WasmSearchEngine(wasm),
  );

  it("四の応酬がある局面では PV が 2 手以上伸び、standPats は pv.length + 1", async () => {
    const engine = await enginePromise;
    const trace = engine.quiescenceTrace(
      buildFourExchangeBoard(),
      "black",
      { row: 10, col: 7 },
      0,
    );
    expect(trace.cut).toBe("searched");
    expect(trace.pv.length).toBeGreaterThanOrEqual(2);
    expect(trace.pv[0]).toEqual({ row: 7, col: 6 });
    expect(trace.pv[1]).toEqual({ row: 7, col: 7 });
    expect(trace.standPats).toHaveLength(trace.pv.length + 1);
    expect(trace.standPats[0]).toBe(trace.standPatRoot);
    expect(trace.value).toBeGreaterThan(trace.standPatRoot);
  });

  it("静かな局面では standpat_cutoff か no_moves で PV は空", async () => {
    const engine = await enginePromise;
    const board = emptyBoard();
    board[7]![7] = "black";
    board[7]![8] = "white";
    const trace = engine.quiescenceTrace(board, "black", { row: 7, col: 8 }, 0);
    expect(["standpat_cutoff", "no_moves"]).toContain(trace.cut);
    expect(trace.pv).toHaveLength(0);
    expect(trace.standPats).toEqual([trace.standPatRoot]);
    expect(trace.value).toBe(trace.standPatRoot);
  });

  it("qDepth=0 は depth_limit", async () => {
    const engine = await enginePromise;
    const trace = engine.quiescenceTrace(
      buildFourExchangeBoard(),
      "black",
      null,
      0,
      0,
    );
    expect(trace.cut).toBe("depth_limit");
    expect(trace.pv).toHaveLength(0);
    expect(trace.value).toBe(trace.standPatRoot);
  });
});
