import type { BoardState } from "@/types/game";

import { type WasmModuleContext, CELL } from "./types";

/**
 * BoardState (string[][]) を WASM 盤面にコピー
 */
export function boardStateToWasm(
  wasm: WasmModuleContext,
  board: BoardState,
): void {
  wasm.boardInit();
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const cell = board[row]?.[col];
      if (cell === "black") {
        wasm.boardSet(row, col, CELL.BLACK);
      } else if (cell === "white") {
        wasm.boardSet(row, col, CELL.WHITE);
      }
    }
  }
}

/**
 * 石の色を WASM の u8 値に変換
 */
export function colorToWasm(color: "black" | "white"): number {
  return color === "black" ? CELL.BLACK : CELL.WHITE;
}
