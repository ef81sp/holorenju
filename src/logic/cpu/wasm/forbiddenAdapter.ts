/**
 * メインスレッド用 禁手判定アダプタ（#37 P1）
 *
 * 北極星「戦術＝Zig、TS＝プレゼン」の最初の実例。CpuGamePlayer の黒石禁手チェックを
 * 禁手専用 thin wasm（Zig 単一ソース）経由にする。クリック時に1点だけ判定する。
 *
 * wasm 未ロード時は TS `checkForbiddenMove` にフォールバック（#21 パリティで TS==WASM を
 * 保証済みのため挙動同値・クラッシュ回避）。このフォールバックは移行期の保険であり、
 * #37 P4 の `forbiddenMoves.ts` 削除時にこの経路も撤去する。
 */
import type { BoardState } from "@/types/game";

import { checkForbiddenMove } from "@/logic/renjuRules/forbiddenMoves";

import {
  loadForbiddenWasm,
  type ForbiddenWasmContext,
} from "./forbiddenLoader";
import { CELL } from "./types";

let wasm: ForbiddenWasmContext | undefined = undefined;

/** 起動時に1回プリロード（非ブロッキング発火を想定）。 */
export async function preloadForbiddenWasm(): Promise<void> {
  if (wasm) {
    return;
  }
  wasm = await loadForbiddenWasm();
}

/** テスト用: wasm インスタンスを直接注入/解除する。 */
export function setForbiddenWasmForTest(
  w: ForbiddenWasmContext | undefined,
): void {
  wasm = w;
}

function syncBoard(w: ForbiddenWasmContext, board: BoardState): void {
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
}

/** 黒が (row,col) に打つと禁手か。候補マスは空き前提。 */
export function isForbiddenForBlack(
  board: BoardState,
  row: number,
  col: number,
): boolean {
  if (wasm) {
    syncBoard(wasm, board);
    return wasm.checkForbiddenPointWasm(row, col) !== 0;
  }
  // フォールバック（wasm 未ロード時）
  return checkForbiddenMove(board, row, col).isForbidden;
}
