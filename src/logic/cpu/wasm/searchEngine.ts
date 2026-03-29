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

/* eslint-disable no-bitwise -- WASM packed return value decoding */

/**
 * WASM findBestMove の戻り値をデコード
 *
 * 上位16bit: score (i16), 下位16bit: row*15+col
 */
function decodeSearchResult(packed: number): {
  position: Position;
  score: number;
} {
  const posIndex = packed & 0xffff;
  const scoreBits = (packed >>> 16) & 0xffff;
  // u16 → i16 の符号付き変換
  const score = scoreBits >= 0x8000 ? scoreBits - 0x10000 : scoreBits;
  const row = Math.floor(posIndex / 15);
  const col = posIndex % 15;
  return { position: { row, col }, score };
}

/**
 * 探索結果
 */
export interface WasmSearchResult {
  position: Position;
  score: number;
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
    const packed = this.wasm.findBestMove(
      colorToWasm(color),
      maxDepth,
      timeLimitMs,
      maxNodes,
    );
    return decodeSearchResult(packed);
  }
}
