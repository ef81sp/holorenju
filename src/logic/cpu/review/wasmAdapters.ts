/**
 * WASM探索エンジンのアダプター関数
 *
 * TS版のオプションオブジェクトをWASMメソッドの個別引数に変換する。
 * timeLimit=Infinity → 0（WASM側で無制限扱い）
 * maxNodes=undefined → 0（WASM側で無制限扱い）
 */

import type { BoardState, Position } from "@/types/game";

import type {
  MiseVCFSearchOptions,
  VCFSearchOptions,
  VCFSequenceResult,
  VCTSearchOptions,
  VCTSequenceResult,
} from "../search/types";
import type { WasmSearchEngine } from "../wasm/searchEngine";

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
  options: VCFSearchOptions,
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
  options: VCFSearchOptions,
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
): VCTSequenceResult | null {
  return engine.findMiseVCFSequence(
    board,
    color,
    toWasmLimit(options.timeLimit),
    toWasmLimit(options.vcfOptions?.maxNodes),
    options.collectBranches ?? false,
  );
}

export function wasmFindVCTSequence(
  engine: WasmSearchEngine,
  board: BoardState,
  color: "black" | "white",
  options: VCTSearchOptions,
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

/**
 * VCT手順探索（被詰み判定専用・strict）
 *
 * 「相手の着手（自分の forcedLoss）を検出する」用途専用。カウンターフォーで
 * テンポを奪い返される手順（幻の被詰み）を棄却する。自分の forcedWin 検出
 * （攻め）には wasmFindVCTSequence（lenient）を使うこと。
 */
export function wasmFindVCTSequenceStrict(
  engine: WasmSearchEngine,
  board: BoardState,
  color: "black" | "white",
  options: VCTSearchOptions,
): VCTSequenceResult | null {
  return engine.findVCTSequenceStrict(
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
  options: VCTSearchOptions,
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
  options: VCTSearchOptions,
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
