/**
 * 脅威分類アダプタ（#37 P3 PR2）
 *
 * 北極星「戦術＝Zig、TS＝プレゼン」に沿い、review/メインの `createsFour` / `createsOpenThree`
 * （四 / 活三 判定）を脅威分類 thin wasm（Zig 単一ソース = vct.classifyThreat）経由にする橋。
 *
 * **本 PR では橋を敷設するだけで利用者はいない**（PR3 以降で利用点を張り替える）。
 *
 * wasm 未ロード時は TS `createsFour` / `createsOpenThree` にフォールバック（#21 パリティ＋
 * 本アダプタのテストで TS==WASM を保証済みのため挙動同値・クラッシュ回避）。このフォールバックは
 * 移行期の保険であり、#37 P4 の `threatMoves.ts` 削除時にこの経路も撤去する。
 *
 * 契約: `board` は (row,col) に `color` を**配置済み**の状態で渡す（TS `createsFour` と同一規約）。
 *
 * 性能ノート: 1 呼び出しごとに全盤同期（boardInit/boardSet + syncBitboard、各 O(225)）。
 * PR3 の利用点（candidateVerification / vcfPuzzle）は候補数が少なく問題ない。盤面全走査で
 * 点ごとに呼ぶ用途（PR6 の findThreatMoves 等）を Zig 化する際は、基盤盤面を 1 度同期して
 * wasm 内で各点を配置・評価する**バッチ API** を別途用意し、点ごとの全盤再同期 O(n²) を避けること。
 */
import type { BoardState } from "@/types/game";

import {
  createsFour as createsFourTs,
  createsOpenThree as createsOpenThreeTs,
} from "@/logic/cpu/search/threatMoves";

import { loadThreatWasm, type ThreatWasmContext } from "./threatLoader";
import { CELL } from "./types";

let wasm: ThreatWasmContext | undefined = undefined;

/** 起動時に1回プリロード（非ブロッキング発火を想定）。 */
export async function preloadThreatWasm(): Promise<void> {
  if (wasm) {
    return;
  }
  wasm = await loadThreatWasm();
}

/** テスト用: wasm インスタンスを直接注入/解除する。 */
export function setThreatWasmForTest(w: ThreatWasmContext | undefined): void {
  wasm = w;
}

function syncBoard(w: ThreatWasmContext, board: BoardState): void {
  w.boardInit();
  for (let row = 0; row < 15; row++) {
    const boardRow = board[row];
    if (!boardRow) {
      continue;
    }
    for (let col = 0; col < 15; col++) {
      const v = boardRow[col];
      if (v === "black") {
        w.boardSet(row, col, CELL.BLACK);
      } else if (v === "white") {
        w.boardSet(row, col, CELL.WHITE);
      }
    }
  }
  // vct.classifyThreat は line_lookup 経由で bitboard.global_bb に依存するため必須。
  w.syncBitboard();
}

export interface ThreatClassification {
  createsFour: boolean;
  createsOpenThree: boolean;
}

/**
 * (row,col) に color を配置済みの盤面で、四 / 活三ができるかを 1 往復で判定する。
 * createsFour と createsOpenThree を両方使う呼び出し元は、本関数で wasm 往復を 1 回に削減できる。
 */
export function classifyThreat(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): ThreatClassification {
  if (wasm) {
    syncBoard(wasm, board);
    // bits ∈ {0,1,2,3}: bit0=four, bit1=openThree。算術で展開（no-bitwise 準拠）。
    const bits = wasm.classifyThreatWasm(
      row,
      col,
      color === "black" ? CELL.BLACK : CELL.WHITE,
    );
    return {
      createsFour: bits === 1 || bits === 3,
      createsOpenThree: bits === 2 || bits === 3,
    };
  }
  // フォールバック（wasm 未ロード時）
  return {
    createsFour: createsFourTs(board, row, col, color),
    createsOpenThree: createsOpenThreeTs(board, row, col, color),
  };
}

/** (row,col) に color を配置済みの盤面で四ができるか（黒は長連除外済）。 */
export function createsFour(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  return classifyThreat(board, row, col, color).createsFour;
}

/** (row,col) に color を配置済みの盤面で活三ができるか。 */
export function createsOpenThree(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  return classifyThreat(board, row, col, color).createsOpenThree;
}
