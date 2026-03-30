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

/**
 * 候補手付き探索結果（レビュー用）
 */
export interface WasmCandidateEntry {
  position: Position;
  score: number;
}

export interface WasmSearchResultWithCandidates extends WasmSearchResult {
  candidates: WasmCandidateEntry[];
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
    this.wasm.findBestMove(
      colorToWasm(color),
      maxDepth,
      timeLimitMs,
      maxNodes,
      0,
      0,
    );
    return this.readResult();
  }

  /**
   * レビュー用の探索（候補手リスト付き）
   *
   * aspiration_mode=1 で段階的拡大幅 [75, 200, 500] を使用。
   */
  findBestMoveForReview(
    board: BoardState,
    color: "black" | "white",
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    absoluteTimeLimitMs: number,
    aspirationMode: number,
  ): WasmSearchResultWithCandidates {
    boardStateToWasm(this.wasm, board);
    this.wasm.ttClear();
    this.wasm.findBestMove(
      colorToWasm(color),
      maxDepth,
      timeLimitMs,
      maxNodes,
      absoluteTimeLimitMs,
      aspirationMode,
    );
    return this.readResultWithCandidates();
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

  private readResultWithCandidates(): WasmSearchResultWithCandidates {
    const ptr = this.wasm.getResultBuffer();
    const { memory } = this.wasm;
    const view = new DataView(memory.buffer);
    const row = view.getUint8(ptr);
    const col = view.getUint8(ptr + 1);
    const score = view.getInt32(ptr + 2, true);
    const completedDepth = view.getUint8(ptr + 6);
    const candidateCount = view.getUint8(ptr + 7);

    const candidates: WasmCandidateEntry[] = [];
    for (let i = 0; i < candidateCount; i++) {
      const base = ptr + 8 + i * 6;
      candidates.push({
        position: {
          row: view.getUint8(base),
          col: view.getUint8(base + 1),
        },
        score: view.getInt32(base + 2, true),
      });
    }

    return { position: { row, col }, score, completedDepth, candidates };
  }
}
