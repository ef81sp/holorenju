/**
 * メインスレッド用 禁手判定アダプタ（#37 P1）
 *
 * 北極星「戦術＝Zig、TS＝プレゼン」の最初の実例。CpuGamePlayer の黒石禁手チェックを
 * 禁手専用 thin wasm（Zig 単一ソース）経由にする。クリック時に1点だけ判定する。
 *
 * #43 PR-6: forbiddenMoves.ts 物理削除に伴い TS フォールバックを撤去（pure-wasm）。
 * 利用前に wasm がロード済みであることが前提（本番=main.ts ブートゲート、テスト=wasm-preload setup）。
 */
import type { BoardState } from "@/types/game";

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
  return forbiddenTypeCode(board, row, col) !== 0;
}

/** 禁手の種類（黒）。"none" の場合は null。候補マスは空き前提。 */
export type ForbiddenType = "overline" | "double-four" | "double-three";

/** wasm の ForbiddenType enum: 0=none/1=overline/2=double_four/3=double_three（forbidden.zig と一致）。 */
function forbiddenTypeCode(
  board: BoardState,
  row: number,
  col: number,
): number {
  if (!wasm) {
    throw new Error(
      "forbidden wasm 未ロード: preloadForbiddenWasm() を起動時/テストsetupで呼ぶこと",
    );
  }
  syncBoard(wasm, board);
  return wasm.checkForbiddenPointWasm(row, col);
}

/** 黒が (row,col) に打ったときの禁手種別。非禁手は null。 */
export function getForbiddenType(
  board: BoardState,
  row: number,
  col: number,
): ForbiddenType | null {
  switch (forbiddenTypeCode(board, row, col)) {
    case 1:
      return "overline";
    case 2:
      return "double-four";
    case 3:
      return "double-three";
    default:
      return null;
  }
}
