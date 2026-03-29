/**
 * WASM版探索エンジン
 *
 * boardStateToWasm で盤面をコピーし、WASM findBestMove を呼ぶ。
 * 難易度パラメータから maxDepth/timeLimit/maxNodes を取得。
 */

import type { BoardState, Position } from "@/types/game";

import { DIFFICULTY_PARAMS, type CpuDifficulty } from "@/types/cpu";

import type { WasmModuleContext } from "./types";

import { boardStateToWasm, colorToWasm } from "./boardAdapter";

/**
 * 探索結果
 */
export interface WasmSearchResult {
  position: Position;
  score: number;
  completedDepth: number;
}

export class WasmSearchEngine {
  private readonly wasm: WasmModuleContext;

  constructor(wasm: WasmModuleContext) {
    this.wasm = wasm;
  }

  findBestMove(
    board: BoardState,
    color: "black" | "white",
    difficulty: CpuDifficulty,
  ): WasmSearchResult {
    const params = DIFFICULTY_PARAMS[difficulty];
    return this.findBestMoveWithParams(
      board,
      color,
      params.depth,
      params.timeLimit,
      params.maxNodes,
    );
  }

  findBestMoveWithParams(
    board: BoardState,
    color: "black" | "white",
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
  ): WasmSearchResult {
    boardStateToWasm(this.wasm, board);
    this.wasm.ttClear();
    this.wasm.findBestMove(colorToWasm(color), maxDepth, timeLimitMs, maxNodes);
    return this.readResult();
  }

  private readResult(): WasmSearchResult {
    const ptr = this.wasm.getResultBuffer();
    const { memory } = this.wasm;
    const view = new DataView(memory.buffer);
    const row = view.getUint8(ptr);
    const col = view.getUint8(ptr + 1);
    const score = view.getInt32(ptr + 2, true); // little-endian i32
    const completedDepth = view.getUint8(ptr + 6);
    return { position: { row, col }, score, completedDepth };
  }
}
