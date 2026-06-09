/**
 * 図形パターンプリミティブ アダプタ（#37 P4 PR-A）
 *
 * 連珠ルールの図形判定（跳び四 / 跳び三 / 達四 / 達四点列挙）を Zig 単一ソース
 * （jump_patterns.zig、threat_wasm 経由）に委譲する橋。最終的に TS 二重実装
 * `src/logic/renjuRules/patterns.ts` を物理削除（#43）するための布石。
 *
 * - wasm インスタンスは threatLoader の共有シングルトン（`getThreatWasm`）を共用。二重ロード回避。
 * - これらの Zig 関数は cells 直読み（bitboard 非依存）なので boardInit/boardSet のみ同期
 *   （syncBitboard 不要）。
 * - 契約は TS 版と同じく (row,col) に color を**配置済み**の board を渡す。
 * - 未ロード時は TS `patterns.ts` にフォールバック（移行期の保険。#43 PR-D で撤去）。
 */
import type { BoardState, Position } from "@/types/game";

import { getThreatWasm, type ThreatWasmContext } from "./threatLoader";
import { CELL } from "./types";

/** ロード済み threat wasm を返す。未ロード時は明示エラー（#43 PR-6 で pure-wasm 化）。 */
function requireWasm(): ThreatWasmContext {
  const w = getThreatWasm();
  if (!w) {
    throw new Error(
      "threat wasm 未ロード: preloadThreatWasm() を起動時/テストsetupで呼ぶこと",
    );
  }
  return w;
}

/** cells のみ同期（jump_patterns は bitboard を使わないため syncBitboard は不要）。 */
function syncCells(w: ThreatWasmContext, board: BoardState): void {
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

function colorEnum(color: "black" | "white"): number {
  return color === "black" ? CELL.BLACK : CELL.WHITE;
}

/** pattern points バッファ（[u8 count][count*(row,col)]）を Position[] に読み出す。 */
function readPatternPoints(w: ThreatWasmContext): Position[] {
  const mem = new Uint8Array(w.memory.buffer);
  const off = w.getPatternPointsBuffer();
  const count = mem[off] ?? 0;
  const positions: Position[] = [];
  let o = off + 1;
  for (let i = 0; i < count; i++) {
    positions.push({ row: mem[o] ?? 0, col: mem[o + 1] ?? 0 });
    o += 2;
  }
  return positions;
}

/** (row,col,dir,color) で跳び四が成立するか。配置済み board 規約。 */
export function checkJumpFour(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: "black" | "white",
): boolean {
  const w = requireWasm();
  syncCells(w, board);
  return w.checkJumpFourWasm(row, col, dirIndex, colorEnum(color)) !== 0;
}

/** (row,col,dir,color) で跳び三が成立するか。配置済み board 規約。 */
export function checkJumpThree(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: "black" | "white",
): boolean {
  const w = requireWasm();
  syncCells(w, board);
  return w.checkJumpThreeWasm(row, col, dirIndex, colorEnum(color)) !== 0;
}

/** (row,col,dir,color) で達四が成立するか。配置済み board 規約。 */
export function checkStraightFour(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: "black" | "white" = "black",
): boolean {
  const w = requireWasm();
  syncCells(w, board);
  return w.checkStraightFourWasm(row, col, dirIndex, colorEnum(color)) !== 0;
}

/** 連続三の達四点（最大2点）を列挙する。配置済み board 規約。 */
export function getConsecutiveThreeStraightFourPoints(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: "black" | "white" = "black",
): Position[] {
  const w = requireWasm();
  syncCells(w, board);
  w.getConsecutiveThreeStraightFourPointsWasm(
    row,
    col,
    dirIndex,
    colorEnum(color),
  );
  return readPatternPoints(w);
}

/** 跳び三の達四点（最大1点）を列挙する。配置済み board 規約。 */
export function getJumpThreeStraightFourPoints(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: "black" | "white" = "black",
): Position[] {
  const w = requireWasm();
  syncCells(w, board);
  w.getJumpThreeStraightFourPointsWasm(row, col, dirIndex, colorEnum(color));
  return readPatternPoints(w);
}
