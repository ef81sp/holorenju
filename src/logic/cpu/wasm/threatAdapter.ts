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
import type { BoardState, Position } from "@/types/game";

import {
  detectOpponentThreats as detectOpponentThreatsTs,
  type ThreatInfo,
} from "@/logic/cpu/evaluation";
import {
  findDoubleMiseMoves as findDoubleMiseMovesTs,
  findMiseTargets as findMiseTargetsTs,
} from "@/logic/cpu/evaluation/miseTactics";
import { createsFourThree as createsFourThreeTs } from "@/logic/cpu/evaluation/winningPatterns";
import {
  createsFour as createsFourTs,
  createsOpenThree as createsOpenThreeTs,
} from "@/logic/cpu/search/threatMoves";
import {
  findThreatMoves as findThreatMovesTs,
  hasFourThreeAvailable as hasFourThreeAvailableTs,
  hasOpenThree as hasOpenThreeTs,
} from "@/logic/cpu/search/vctHelpers";

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

/**
 * ロード済み threat wasm インスタンスを返す（未ロード時 undefined）。
 * patternsAdapter（#37 P4）が同一インスタンスを共用し threat.wasm の二重ロードを避けるため。
 */
export function getThreatWasm(): ThreatWasmContext | undefined {
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

/**
 * (row,col)（**空き**前提）に color を打つと四三ができるか（黒は禁手考慮）。
 * wasm 経由は Zig `evaluate.createsFourThree`。未ロード時は TS にフォールバック。
 * 契約は TS `createsFourThree` と同じく**候補は空き**（内部で仮置き・復元）。
 */
export function createsFourThree(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  if (wasm) {
    syncBoard(wasm, board);
    return (
      wasm.createsFourThreeWasm(
        row,
        col,
        color === "black" ? CELL.BLACK : CELL.WHITE,
      ) !== 0
    );
  }
  return createsFourThreeTs(board, row, col, color);
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
 * wasm 経由は Zig `threats.detectOpponentThreats`。未ロード時は TS にフォールバック。
 */
export function detectOpponentThreats(
  board: BoardState,
  opponentColor: "black" | "white",
): ThreatInfo {
  if (wasm) {
    syncBoard(wasm, board);
    wasm.detectOpponentThreatsWasm(
      opponentColor === "black" ? CELL.BLACK : CELL.WHITE,
    );
    const mem = new Uint8Array(wasm.memory.buffer);
    let off = wasm.getThreatInfoBuffer();
    const openFours = readPositionList(mem, off);
    const fours = readPositionList(mem, openFours.next);
    const openThrees = readPositionList(mem, fours.next);
    const mises = readPositionList(mem, openThrees.next);
    const doubleThrees = readPositionList(mem, mises.next);
    off = doubleThrees.next;
    return {
      openFours: openFours.positions,
      fours: fours.positions,
      openThrees: openThrees.positions,
      mises: mises.positions,
      doubleThrees: doubleThrees.positions,
    };
  }
  // フォールバック（wasm 未ロード時）
  return detectOpponentThreatsTs(board, opponentColor);
}

/**
 * (row,col) に color のミセ手を**配置済み**の盤面で、四三ターゲット点（空き）を列挙する（#37 P3 PR5b）。
 * wasm 経由は Zig `evaluate.findMiseTargets`。未ロード時は TS にフォールバック。
 * 契約は TS `findMiseTargets` と同じく石を置いた状態で渡す。
 */
export function findMiseTargets(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  if (wasm) {
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
  return findMiseTargetsTs(board, row, col, color);
}

/**
 * color の両ミセ手（どの防御でも別の四三が残る手）を盤面全体から列挙する（#37 P3 PR5b）。
 * wasm 経由は Zig `evaluate.findDoubleMiseMoves`。未ロード時は TS にフォールバック。
 */
export function findDoubleMiseMoves(
  board: BoardState,
  color: "black" | "white",
): Position[] {
  if (wasm) {
    syncBoard(wasm, board);
    wasm.findDoubleMiseMovesWasm(color === "black" ? CELL.BLACK : CELL.WHITE);
    const mem = new Uint8Array(wasm.memory.buffer);
    const { positions } = readPositionList(mem, wasm.getDoubleMiseBuffer());
    return positions;
  }
  return findDoubleMiseMovesTs(board, color);
}

/**
 * color が活三（連続三で両端空き／跳び三）を盤面上に持つか（#37 P3 PR6）。
 * wasm 経由は Zig `vct.hasOpenThree`。未ロード時は TS にフォールバック。
 * review 利用点（VCT 検証）は lineTable なしの全盤走査パスで呼ぶため、本アダプタも
 * lineTable を受けない（Zig 版も全盤走査）。
 */
export function hasOpenThree(
  board: BoardState,
  color: "black" | "white",
): boolean {
  if (wasm) {
    syncBoard(wasm, board);
    return (
      wasm.hasOpenThreeWasm(color === "black" ? CELL.BLACK : CELL.WHITE) !== 0
    );
  }
  return hasOpenThreeTs(board, color);
}

/**
 * color がミセ手（1手で四三を作れる手）を盤面上に持つか（#37 P3 PR6）。
 * wasm 経由は Zig `vct.hasFourThreeAvailable`（黒は禁手考慮）。未ロード時は TS にフォールバック。
 */
export function hasFourThreeAvailable(
  board: BoardState,
  color: "black" | "white",
): boolean {
  if (wasm) {
    syncBoard(wasm, board);
    return (
      wasm.hasFourThreeAvailableWasm(
        color === "black" ? CELL.BLACK : CELL.WHITE,
      ) !== 0
    );
  }
  return hasFourThreeAvailableTs(board, color);
}

/**
 * color の脅威手（四・活三を作れる空き点、四優先・row-major）を列挙する（#37 P3 PR6）。
 * wasm 経由は Zig `vct.findThreatMoves`。未ロード時は TS にフォールバック。
 */
export function findThreatMoves(
  board: BoardState,
  color: "black" | "white",
): Position[] {
  if (wasm) {
    syncBoard(wasm, board);
    wasm.findThreatMovesWasm(color === "black" ? CELL.BLACK : CELL.WHITE);
    const mem = new Uint8Array(wasm.memory.buffer);
    const { positions } = readPositionList(mem, wasm.getThreatMovesBuffer());
    return positions;
  }
  return findThreatMovesTs(board, color);
}
