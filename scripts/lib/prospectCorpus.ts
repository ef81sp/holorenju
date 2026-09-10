/**
 * prospect コーパス抽出の共通部（docs/plans/eval-r4-2026-09-11.md §1〜§2）。
 *
 * - `readBenchGames`: commit-bench 形（`{games:[...]}`）と weight-bench 形
 *   （トップレベル配列）の両方を読む。`valid:false` の run（決定的モードで abort が
 *   出た run）は 0 局として扱う。
 * - `tryEmitQuietPosition`: quiet フィルタ（即五 stm/opp なし、hasVCF maxNodes=200 なし）
 *   + 特徴抽出 + dedup + emit を 1 関数にまとめたもの。棋譜（`sampleGame`）・
 *   ブック（`sampleBook`）・開局スイート prefix（`samplePrefix`）の 3 源が共用する。
 * - 盤面キーはブック形式 `${boardToString(board)}|${stm}`（`parseBoardKey` で往復可）。
 * - 回帰ゲート局面（`REGRESSION_POSITIONS`）は `excluded` に事前投入して学習から除く。
 *
 * quiet フィルタ（事前登録、r2 と同じ）:
 *   1. ply ∈ [minPly, 終局−endMargin]（棋譜）/ 石数 ≥ minPly（ブック・prefix）
 *   2. 手番側に即五なし / 3. 相手側に即五なし（必須防御局面の除外）
 *   4. hasVCF(手番側) が false（maxNodes=200 予算）
 *   5. |Rapfi eval| 上限カットはラベラー側で適用
 *   6. 盤面キー + 手番でグローバル dedup（源横断）
 *   7. 1局あたり sampleInterval ply 間隔・最大 maxPerGame 局面（棋譜）
 */

import { readFileSync } from "node:fs";

import type { WasmModuleContext } from "@/logic/cpu/wasm/types";
import type { BoardState, Position, StoneColor } from "@/types/game";

import { boardToString } from "@/logic/boardSymmetry";
import { hasVCF } from "@/logic/cpu/search/vcfCheck";
import { boardStateToWasm, colorToWasm } from "@/logic/cpu/wasm/boardAdapter";
import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { checkWin, createEmptyBoard } from "@/logic/renjuRules";

import type {
  CorpusRow,
  CorpusSide,
  CorpusSource,
  CorpusSourceKind,
} from "../types/prospectCorpus.ts";
import type { OpeningSource } from "./match.ts";

import { PROSPECT_FEATURE_COUNT } from "./evalParams.ts";
import { parseBoardKey } from "./openingSuite.ts";
import { REGRESSION_POSITIONS } from "./regressionPositions.ts";

// ---------------------------------------------------------------------------
// ベンチ棋譜 JSON のローダ
// ---------------------------------------------------------------------------

export interface BenchMove {
  row: number;
  col: number;
}

/** 棋譜サンプリングに必要な最小形（commit-bench / weight-bench の games 要素）。 */
export interface BenchGame {
  winner: "A" | "B" | "draw";
  moveHistory: BenchMove[];
  isABlack: boolean;
  jushuName: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseGame(raw: unknown, label: string, idx: number): BenchGame {
  if (!isRecord(raw)) {
    throw new Error(`${label}: games[${idx}] がオブジェクトでない`);
  }
  const { winner, moveHistory, isABlack, jushuName } = raw;
  if (winner !== "A" && winner !== "B" && winner !== "draw") {
    throw new Error(`${label}: games[${idx}].winner が不正: ${String(winner)}`);
  }
  if (!Array.isArray(moveHistory)) {
    throw new Error(`${label}: games[${idx}].moveHistory が配列でない`);
  }
  if (typeof isABlack !== "boolean") {
    throw new Error(`${label}: games[${idx}].isABlack が boolean でない`);
  }
  const moves: BenchMove[] = moveHistory.map((m: unknown, i) => {
    if (
      !isRecord(m) ||
      typeof m["row"] !== "number" ||
      typeof m["col"] !== "number"
    ) {
      throw new Error(
        `${label}: games[${idx}].moveHistory[${i}] に row/col がない`,
      );
    }
    return { row: m["row"], col: m["col"] };
  });
  return {
    winner,
    moveHistory: moves,
    isABlack,
    jushuName: typeof jushuName === "string" ? jushuName : "",
  };
}

/**
 * ベンチ結果 JSON（パース済み）から games を取り出す（純粋）。
 * - commit-bench 形: `{ games: [...] }`。`valid === false` なら空。games 欠落も空。
 * - weight-bench 形: トップレベル配列。
 * それ以外の形・要素の不正は例外（黙って 0 局にしない）。
 */
export function parseBenchGames(raw: unknown, label: string): BenchGame[] {
  const games = extractGamesArray(raw, label);
  return games.map((g, i) => parseGame(g, label, i));
}

function extractGamesArray(raw: unknown, label: string): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (!isRecord(raw)) {
    throw new Error(
      `${label}: ベンチ JSON の形が不正（配列でもオブジェクトでもない）`,
    );
  }
  if (raw["valid"] === false) {
    return [];
  }
  const g = raw["games"];
  if (g === undefined) {
    return [];
  }
  if (!Array.isArray(g)) {
    throw new Error(`${label}: games が配列でない`);
  }
  return g;
}

export function readBenchGames(path: string): BenchGame[] {
  return parseBenchGames(JSON.parse(readFileSync(path, "utf8")), path);
}

// ---------------------------------------------------------------------------
// 盤面キー・quiet 判定・特徴
// ---------------------------------------------------------------------------

/** ブック形式の盤面キー（`parseBoardKey` で往復可）。 */
export function boardKey(board: BoardState, stm: CorpusSide): string {
  return `${boardToString(board)}|${stm}`;
}

/** color がどこかの空点に置いて即座に五（勝ち）を作れるか。盤面は変更しない。 */
export function hasImmediateFive(
  board: BoardState,
  color: CorpusSide,
): boolean {
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board.length; col++) {
      if (board[row]![col] !== null) {
        continue;
      }
      board[row]![col] = color;
      const wins = checkWin(board, { row, col }, color);
      board[row]![col] = null;
      if (wins) {
        return true;
      }
    }
  }
  return false;
}

/** extractProspectFeatures(stm, stmIsPerspective=1) の i32×34 を読み出す。 */
export function extractFeatures(
  wasm: WasmModuleContext,
  board: BoardState,
  stm: CorpusSide,
): number[] {
  boardStateToWasm(wasm, board);
  const count = wasm.extractProspectFeatures(colorToWasm(stm), 1);
  if (count !== PROSPECT_FEATURE_COUNT) {
    throw new Error(
      `特徴数不一致: got ${count}, want ${PROSPECT_FEATURE_COUNT}`,
    );
  }
  const ptr = wasm.getProspectFeatureBuffer();
  const view = new DataView(wasm.memory.buffer);
  const features: number[] = [];
  for (let i = 0; i < count; i++) {
    features.push(view.getInt32(ptr + i * 4, true));
  }
  return features;
}

function stonesOf(board: BoardState, color: CorpusSide): Position[] {
  const out: Position[] = [];
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board.length; col++) {
      if (board[row]![col] === color) {
        out.push({ row, col });
      }
    }
  }
  return out;
}

function opponentOf(stm: CorpusSide): CorpusSide {
  return stm === "black" ? "white" : "black";
}

function sideToMoveOf(stoneCount: number): CorpusSide {
  return stoneCount % 2 === 0 ? "black" : "white";
}

// ---------------------------------------------------------------------------
// フィルタ統計・emit
// ---------------------------------------------------------------------------

export interface FilterStats {
  candidates: number;
  rejectedRegression: number;
  rejectedDup: number;
  rejectedFiveStm: number;
  rejectedFiveOpp: number;
  rejectedVcf: number;
  emitted: number;
}

export function createFilterStats(): FilterStats {
  return {
    candidates: 0,
    rejectedRegression: 0,
    rejectedDup: 0,
    rejectedFiveStm: 0,
    rejectedFiveOpp: 0,
    rejectedVcf: 0,
    emitted: 0,
  };
}

export interface QuietEmitContext {
  wasm: WasmModuleContext;
  /** 源横断の dedup 集合（emit 済み key）。 */
  seen: Set<string>;
  /** 学習から除外する key（回帰ゲート局面）。seen より先に判定し rejectedRegression に数える。 */
  excluded: Set<string>;
  stats: FilterStats;
  emit: (row: CorpusRow) => void;
}

/** hasVCF の予算。timeLimit はノード予算より十分大きくし、実質 maxNodes のみで打ち切る（マシン速度で結果が変わらないように）。 */
const QUIET_VCF_OPTIONS = { maxNodes: 200, timeLimit: 10_000 } as const;

/**
 * 1 局面に quiet フィルタを掛け、通れば特徴を抽出して emit する。
 * 戻り値は emit したか。盤面は変更しない（作業用の着手は戻す）。
 */
export function tryEmitQuietPosition(
  ctx: QuietEmitContext,
  board: BoardState,
  stm: CorpusSide,
  source: CorpusSource,
  outcome: number,
): boolean {
  const { stats } = ctx;
  stats.candidates++;
  const key = boardKey(board, stm);
  if (ctx.excluded.has(key)) {
    stats.rejectedRegression++;
    return false;
  }
  if (ctx.seen.has(key)) {
    stats.rejectedDup++;
    return false;
  }
  if (hasImmediateFive(board, stm)) {
    stats.rejectedFiveStm++;
    return false;
  }
  if (hasImmediateFive(board, opponentOf(stm))) {
    stats.rejectedFiveOpp++;
    return false;
  }
  if (hasVCF(board, stm, 0, undefined, QUIET_VCF_OPTIONS)) {
    stats.rejectedVcf++;
    return false;
  }
  ctx.seen.add(key);
  ctx.emit({
    key,
    source,
    stm,
    black: stonesOf(board, "black"),
    white: stonesOf(board, "white"),
    features: extractFeatures(ctx.wasm, board, stm),
    outcome,
  });
  stats.emitted++;
  return true;
}

// ---------------------------------------------------------------------------
// 3 源のサンプラ
// ---------------------------------------------------------------------------

export interface GameSampleOptions {
  minPly: number;
  endMargin: number;
  sampleInterval: number;
  maxPerGame: number;
}

/** 棋譜 1 局を再生しながら quiet 局面をサンプルする。 */
export function sampleGame(
  ctx: QuietEmitContext,
  game: BenchGame,
  file: string,
  gameIdx: number,
  opts: GameSampleOptions,
): number {
  const len = game.moveHistory.length;
  const maxPly = len - opts.endMargin;
  const board: BoardState = createEmptyBoard();

  let winnerColor: StoneColor = null;
  if (game.winner !== "draw") {
    winnerColor = (game.winner === "A") === game.isABlack ? "black" : "white";
  }

  let sampled = 0;
  let lastSampledPly = -Infinity;

  for (let ply = 0; ply < len; ply++) {
    // ply 手置かれた状態（= moveHistory[ply] を置く直前）を検討する。
    if (
      ply >= opts.minPly &&
      ply <= maxPly &&
      sampled < opts.maxPerGame &&
      ply - lastSampledPly >= opts.sampleInterval
    ) {
      const stm = sideToMoveOf(ply);
      let outcome = 0.5;
      if (winnerColor !== null) {
        outcome = winnerColor === stm ? 1 : 0;
      }
      const emitted = tryEmitQuietPosition(
        ctx,
        board,
        stm,
        { kind: "kifu", file, gameIdx, ply, jushu: game.jushuName },
        outcome,
      );
      if (emitted) {
        sampled++;
        lastSampledPly = ply;
      }
    }
    const move = game.moveHistory[ply]!;
    board[move.row]![move.col] = sideToMoveOf(ply);
  }
  return sampled;
}

export interface StaticSampleOptions {
  /** 石数がこれ未満の局面は候補にしない。 */
  minPly: number;
}

/**
 * オープニングブックの entries（key = ブック形式の盤面キー）を局面として投入する。
 * 1 局面 1 グループ（gameIdx = entries の index）。outcome は 0.5 固定。
 */
export function sampleBook(
  ctx: QuietEmitContext,
  entries: Record<string, unknown>,
  file: string,
  opts: StaticSampleOptions,
): number {
  let emitted = 0;
  Object.keys(entries).forEach((key, idx) => {
    const { board, sideToMove } = parseBoardKey(key);
    const ply =
      stonesOf(board, "black").length + stonesOf(board, "white").length;
    if (ply < opts.minPly) {
      return;
    }
    if (
      tryEmitQuietPosition(
        ctx,
        board,
        sideToMove,
        { kind: "book", file, gameIdx: idx, ply, jushu: "" },
        0.5,
      )
    ) {
      emitted++;
    }
  });
  return emitted;
}

/**
 * 開局スイートの各開局 moves を先頭 n 手（n ∈ plies）で切った局面を投入する。
 * 黒番（n 偶数）・白番（n 奇数）の両方が出る。1 局面 1 グループ（gameIdx は連番）。
 */
export function samplePrefix(
  ctx: QuietEmitContext,
  openings: readonly OpeningSource[],
  file: string,
  plies: readonly number[],
  opts: StaticSampleOptions,
): number {
  let emitted = 0;
  let nextIdx = 0;
  for (const opening of openings) {
    for (const n of plies) {
      if (n < opts.minPly || n > opening.positions.length) {
        continue;
      }
      const board = createEmptyBoard();
      for (let i = 0; i < n; i++) {
        const p = opening.positions[i]!;
        board[p.row]![p.col] = sideToMoveOf(i);
      }
      const gameIdx = nextIdx++;
      if (
        tryEmitQuietPosition(
          ctx,
          board,
          sideToMoveOf(n),
          { kind: "prefix", file, gameIdx, ply: n, jushu: opening.id },
          0.5,
        )
      ) {
        emitted++;
      }
    }
  }
  return emitted;
}

// ---------------------------------------------------------------------------
// 回帰ゲート局面の除外
// ---------------------------------------------------------------------------

/** REGRESSION_POSITIONS の各 kifuPrefix を再生した統一 key（excluded に投入する）。 */
export function regressionPositionKeys(): string[] {
  return REGRESSION_POSITIONS.map((pos) => {
    const { board, nextColor } = createBoardFromRecord(pos.kifuPrefix);
    if (nextColor !== pos.sideToMove) {
      throw new Error(
        `${pos.id}: kifuPrefix の手数と sideToMove が矛盾（棋譜=${nextColor}, 指定=${pos.sideToMove}）`,
      );
    }
    return boardKey(board, pos.sideToMove);
  });
}

// ---------------------------------------------------------------------------
// 行数表（源 kind × ply 帯 × 手番）
// ---------------------------------------------------------------------------

export const PLY_BANDS = ["<4", "4-6", "7", "8-15", "16-25", "26+"] as const;
export type PlyBand = (typeof PLY_BANDS)[number];

export function plyBand(ply: number): PlyBand {
  if (ply < 4) {
    return "<4";
  }
  if (ply <= 6) {
    return "4-6";
  }
  if (ply === 7) {
    return "7";
  }
  if (ply <= 15) {
    return "8-15";
  }
  if (ply <= 25) {
    return "16-25";
  }
  return "26+";
}

export const SOURCE_KINDS: readonly CorpusSourceKind[] = [
  "kifu",
  "book",
  "prefix",
];

export type SideCounts = Record<CorpusSide, number>;
export type RowTable = Record<CorpusSourceKind, Record<PlyBand, SideCounts>>;

export function createRowTable(): RowTable {
  const table = {} as RowTable;
  for (const kind of SOURCE_KINDS) {
    const bands = {} as Record<PlyBand, SideCounts>;
    for (const band of PLY_BANDS) {
      bands[band] = { black: 0, white: 0 };
    }
    table[kind] = bands;
  }
  return table;
}

export function tallyRow(table: RowTable, row: CorpusRow): void {
  table[row.source.kind][plyBand(row.source.ply)][row.stm]++;
}

/** 源 kind × ply 帯 × 手番の行数表を整形する（0 行の帯は省略、kind 小計と総合計付き）。 */
export function formatRowTable(table: RowTable): string {
  const lines: string[] = [];
  const pad = (s: string, n: number): string => s.padStart(n);
  lines.push(
    `${"kind".padEnd(7)}${"ply".padEnd(7)}${pad("black", 7)}${pad("white", 7)}${pad("total", 7)}`,
  );
  let grandBlack = 0;
  let grandWhite = 0;
  for (const kind of SOURCE_KINDS) {
    let subBlack = 0;
    let subWhite = 0;
    for (const band of PLY_BANDS) {
      const c = table[kind][band];
      if (c.black + c.white === 0) {
        continue;
      }
      subBlack += c.black;
      subWhite += c.white;
      lines.push(
        `${kind.padEnd(7)}${band.padEnd(7)}${pad(String(c.black), 7)}${pad(String(c.white), 7)}${pad(String(c.black + c.white), 7)}`,
      );
    }
    if (subBlack + subWhite === 0) {
      continue;
    }
    lines.push(
      `${kind.padEnd(7)}${"小計".padEnd(6)}${pad(String(subBlack), 7)}${pad(String(subWhite), 7)}${pad(String(subBlack + subWhite), 7)}`,
    );
    grandBlack += subBlack;
    grandWhite += subWhite;
  }
  lines.push(
    `${"合計".padEnd(12)}${pad(String(grandBlack), 7)}${pad(String(grandWhite), 7)}${pad(String(grandBlack + grandWhite), 7)}`,
  );
  return lines.join("\n");
}
