/**
 * WASM/TS 評価関数ブリッジ
 *
 * BoardEvaluator インターフェースで TS版とWASM版を切り替え可能にする。
 * 探索コアは BoardEvaluator 経由で evaluateBoard を呼び出す。
 */

import type { BoardState } from "@/types/game";

import type { LeafEvaluationOptions } from "../evaluation/patternScores";
import type { LineTable } from "../lineTable/lineTable";
import type { WasmModuleContext } from "./types";

import { boardStateToWasm, colorToWasm } from "./boardAdapter";

/* eslint-disable no-bitwise -- WASM option bitfield encoding */

/**
 * 評価関数の抽象インターフェース
 *
 * TS版・WASM版を透過的に切り替えるために使用
 */
export interface BoardEvaluator {
  evaluateBoard(
    board: BoardState,
    perspective: "black" | "white",
    options?: LeafEvaluationOptions,
    lineTable?: LineTable,
  ): number;
}

/**
 * EvalOptions を WASM ビットフィールドにエンコード
 */
function encodeEvalOptions(options?: LeafEvaluationOptions): number {
  if (!options) {
    return 0;
  }

  let flags = 0;

  if (options.enableLeafMise) {
    flags |= 1;
  }

  if (options.lastMoverIsPerspective !== undefined) {
    flags |= (options.lastMoverIsPerspective ? 1 : 2) << 1;
  }

  if (options.singleFourPenaltyMultiplier !== undefined) {
    const raw = Math.round(options.singleFourPenaltyMultiplier * 100);
    flags |= (raw & 0xff) << 8;
  }

  if (options.connectivityBonusValue !== undefined) {
    const raw =
      options.connectivityBonusValue === 0
        ? 255
        : options.connectivityBonusValue;
    flags |= (raw & 0xff) << 16;
  }

  return flags;
}

/**
 * WASM版 evaluateBoard をラップする BoardEvaluator
 *
 * 毎回 boardStateToWasm で盤面をコピーし、WASM の evaluateBoard を呼ぶ。
 * lineTable は無視される（WASM 側は独自の盤面表現を使用）。
 */
export class WasmBoardEvaluator implements BoardEvaluator {
  private readonly wasm: WasmModuleContext;

  constructor(wasm: WasmModuleContext) {
    this.wasm = wasm;
  }

  evaluateBoard(
    board: BoardState,
    perspective: "black" | "white",
    options?: LeafEvaluationOptions,
  ): number {
    boardStateToWasm(this.wasm, board);
    return this.wasm.evaluateBoard(
      colorToWasm(perspective),
      encodeEvalOptions(options),
    );
  }
}
