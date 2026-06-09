/**
 * 脅威分類アダプタ（#37 P3 PR2 / P4 PR-6 で pure-wasm 化）
 *
 * 北極星「戦術＝Zig、TS＝プレゼン」に沿い、review/VCFパズルの脅威判定（四 / 活三 / 四三 /
 * ミセ / 脅威手列挙）を Zig 単一ソース（threat thin wasm = vct/threats/evaluate）経由で提供する。
 *
 * #43 PR-6: patterns.ts/forbiddenMoves.ts 物理削除に伴い TS フォールバックを撤去（pure-wasm）。
 * 利用前に wasm がロード済みであることが前提（本番=main.ts ブートゲート、テスト=wasm-preload setup）。
 *
 * 契約: `board` は (row,col) に `color` を**配置済み**の状態で渡す（classifyThreat 系）。
 *
 * 性能ノート: 1 呼び出しごとに全盤同期（boardInit/boardSet + syncBitboard、各 O(225)）。
 * review/VCFパズルは非ホットパス（1クリック/着手駆動）なので許容。
 */
import type { ThreatInfo } from "@/logic/cpu/evaluation";
import type { BoardState, Position } from "@/types/game";

import {
  getThreatWasm,
  preloadThreatWasm,
  setThreatWasmForTest,
  type ThreatWasmContext,
} from "./threatLoader";
import { CELL } from "./types";

// wasm シングルトン管理は threatLoader（中立な低レベル）。後方互換で re-export する。
export { getThreatWasm, preloadThreatWasm, setThreatWasmForTest };

/** ロード済み threat wasm を返す。未ロード時は明示エラー（フォールバックなし）。 */
function requireThreatWasm(): ThreatWasmContext {
  const wasm = getThreatWasm();
  if (!wasm) {
    throw new Error(
      "threat wasm 未ロード: preloadThreatWasm() を起動時/テストsetupで呼ぶこと",
    );
  }
  return wasm;
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
 */
export function classifyThreat(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): ThreatClassification {
  const wasm = requireThreatWasm();
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

/**
 * (row,col)（**空き**前提）に color を打つと四三ができるか（黒は禁手考慮）。
 * Zig `evaluate.createsFourThree`。契約は**候補は空き**（内部で仮置き・復元）。
 */
export function createsFourThree(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  const wasm = requireThreatWasm();
  syncBoard(wasm, board);
  return (
    wasm.createsFourThreeWasm(
      row,
      col,
      color === "black" ? CELL.BLACK : CELL.WHITE,
    ) !== 0
  );
}

/** wasm バッファから ThreatInfo の1リスト（[count][count*(row,col)]）を読み出す。 */
function readPositionList(
  mem: Uint8Array,
  offset: number,
): { positions: Position[]; next: number } {
  const count = mem[offset] ?? 0;
  let o = offset + 1;
  const positions: Position[] = [];
  for (let i = 0; i < count; i++) {
    positions.push({ row: mem[o] ?? 0, col: mem[o + 1] ?? 0 });
    o += 2;
  }
  return { positions, next: o };
}

/**
 * opponentColor の脅威（活四/止め四/活三/ミセ/三三の各防御位置）を検出する（#37 P3 PR4）。
 * Zig `threats.detectOpponentThreats`。
 */
export function detectOpponentThreats(
  board: BoardState,
  opponentColor: "black" | "white",
): ThreatInfo {
  const wasm = requireThreatWasm();
  syncBoard(wasm, board);
  wasm.detectOpponentThreatsWasm(
    opponentColor === "black" ? CELL.BLACK : CELL.WHITE,
  );
  const mem = new Uint8Array(wasm.memory.buffer);
  const off = wasm.getThreatInfoBuffer();
  const openFours = readPositionList(mem, off);
  const fours = readPositionList(mem, openFours.next);
  const openThrees = readPositionList(mem, fours.next);
  const mises = readPositionList(mem, openThrees.next);
  const doubleThrees = readPositionList(mem, mises.next);
  return {
    openFours: openFours.positions,
    fours: fours.positions,
    openThrees: openThrees.positions,
    mises: mises.positions,
    doubleThrees: doubleThrees.positions,
  };
}

/**
 * (row,col) に color のミセ手を**配置済み**の盤面で、四三ターゲット点（空き）を列挙する（#37 P3 PR5b）。
 * Zig `evaluate.findMiseTargets`。
 */
export function findMiseTargets(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  const wasm = requireThreatWasm();
  syncBoard(wasm, board);
  wasm.findMiseTargetsWasm(
    row,
    col,
    color === "black" ? CELL.BLACK : CELL.WHITE,
  );
  const mem = new Uint8Array(wasm.memory.buffer);
  const { positions } = readPositionList(mem, wasm.getMiseBuffer());
  return positions;
}

/**
 * color の両ミセ手（どの防御でも別の四三が残る手）を盤面全体から列挙する（#37 P3 PR5b）。
 * Zig `evaluate.findDoubleMiseMoves`。
 */
export function findDoubleMiseMoves(
  board: BoardState,
  color: "black" | "white",
): Position[] {
  const wasm = requireThreatWasm();
  syncBoard(wasm, board);
  wasm.findDoubleMiseMovesWasm(color === "black" ? CELL.BLACK : CELL.WHITE);
  const mem = new Uint8Array(wasm.memory.buffer);
  const { positions } = readPositionList(mem, wasm.getDoubleMiseBuffer());
  return positions;
}

/**
 * color が活三（連続三で両端空き／跳び三）を盤面上に持つか（#37 P3 PR6）。
 * Zig `vct.hasOpenThree`。全盤走査。
 */
export function hasOpenThree(
  board: BoardState,
  color: "black" | "white",
): boolean {
  const wasm = requireThreatWasm();
  syncBoard(wasm, board);
  return (
    wasm.hasOpenThreeWasm(color === "black" ? CELL.BLACK : CELL.WHITE) !== 0
  );
}

/**
 * color がミセ手（1手で四三を作れる手）を盤面上に持つか（#37 P3 PR6）。
 * Zig `vct.hasFourThreeAvailable`（黒は禁手考慮）。
 */
export function hasFourThreeAvailable(
  board: BoardState,
  color: "black" | "white",
): boolean {
  const wasm = requireThreatWasm();
  syncBoard(wasm, board);
  return (
    wasm.hasFourThreeAvailableWasm(
      color === "black" ? CELL.BLACK : CELL.WHITE,
    ) !== 0
  );
}

/**
 * color の脅威手（四・活三を作れる空き点、四優先・row-major）を列挙する（#37 P3 PR6）。
 * Zig `vct.findThreatMoves`。
 */
export function findThreatMoves(
  board: BoardState,
  color: "black" | "white",
): Position[] {
  const wasm = requireThreatWasm();
  syncBoard(wasm, board);
  wasm.findThreatMovesWasm(color === "black" ? CELL.BLACK : CELL.WHITE);
  const mem = new Uint8Array(wasm.memory.buffer);
  const { positions } = readPositionList(mem, wasm.getThreatMovesBuffer());
  return positions;
}
