/**
 * WASM探索エンジンのアダプター関数
 *
 * TS版のオプションオブジェクトをWASMメソッドの個別引数に変換する。
 * timeLimit=Infinity → 0（WASM側で無制限扱い）
 * maxNodes=undefined → 0（WASM側で無制限扱い）
 */

import type { BoardState, Position } from "@/types/game";

import type { MiseVCFSearchOptions } from "../search/miseVcf";
import type { VCFSequenceResult } from "../search/vcf";
import type { VCTSequenceResult } from "../search/vct";
import type { WasmSearchEngine } from "../wasm/searchEngine";

/** VCF探索オプション（VCFSearchOptions と同一だが循環 import 回避用） */
interface VCFOptions {
  maxDepth?: number;
  timeLimit?: number;
  maxNodes?: number;
}

/** VCT探索オプション（VCTSearchOptions と同一だが循環 import 回避用） */
interface VCTOptions {
  maxDepth?: number;
  timeLimit?: number;
  maxNodes?: number;
  collectBranches?: boolean;
}

/** Infinity や undefined を WASM の 0 (=無制限) に変換 */
function toWasmLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

export function wasmFindVCFSequence(
  engine: WasmSearchEngine,
  board: BoardState,
  color: "black" | "white",
  options: VCFOptions,
): VCFSequenceResult | null {
  return engine.findVCFSequence(
    board,
    color,
    options.maxDepth ?? 8,
    toWasmLimit(options.timeLimit),
    toWasmLimit(options.maxNodes),
  );
}

export function wasmFindVCFSequenceFromFirstMove(
  engine: WasmSearchEngine,
  board: BoardState,
  firstMove: Position,
  color: "black" | "white",
  options: VCFOptions,
): VCFSequenceResult | null {
  return engine.findVCFSequenceFromFirstMove(
    board,
    firstMove,
    color,
    options.maxDepth ?? 8,
    toWasmLimit(options.timeLimit),
    toWasmLimit(options.maxNodes),
  );
}

export function wasmFindMiseVCFSequence(
  engine: WasmSearchEngine,
  board: BoardState,
  color: "black" | "white",
  options: MiseVCFSearchOptions,
): VCFSequenceResult | null {
  return engine.findMiseVCFSequence(
    board,
    color,
    toWasmLimit(options.timeLimit),
    toWasmLimit(options.vcfOptions?.maxNodes),
  );
}

export function wasmFindVCTSequence(
  engine: WasmSearchEngine,
  board: BoardState,
  color: "black" | "white",
  options: VCTOptions,
): VCTSequenceResult | null {
  return engine.findVCTSequence(
    board,
    color,
    options.maxDepth ?? 4,
    toWasmLimit(options.timeLimit),
    toWasmLimit(options.maxNodes),
    options.collectBranches ?? false,
  );
}

export function wasmFindVCTSequenceFromFirstMove(
  engine: WasmSearchEngine,
  board: BoardState,
  firstMove: Position,
  color: "black" | "white",
  options: VCTOptions,
): VCTSequenceResult | null {
  return engine.findVCTSequenceFromFirstMove(
    board,
    firstMove,
    color,
    options.maxDepth ?? 4,
    toWasmLimit(options.timeLimit),
    toWasmLimit(options.maxNodes),
    options.collectBranches ?? false,
  );
}

export function wasmIsVCTFirstMove(
  engine: WasmSearchEngine,
  board: BoardState,
  move: Position,
  color: "black" | "white",
  options: VCTOptions,
): boolean {
  return engine.isVCTFirstMove(
    board,
    move,
    color,
    options.maxDepth ?? 4,
    toWasmLimit(options.timeLimit),
    toWasmLimit(options.maxNodes),
  );
}
