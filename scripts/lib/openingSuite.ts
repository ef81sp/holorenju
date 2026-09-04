/**
 * 開局スイート生成（bench-precision-2026-09-04.md §2.2）の純粋部分。
 *
 * - オープニングブック（opening-book-hard.json）の entries キー（225 文字の
 *   盤面文字列 + `|white`）を盤面へ戻す（`boardToString` の逆変換）。
 * - 7 石（黒 4・白 3）局面を、黒から交互に並べた擬似手順 `Position[]` に変換する
 *   （着手順は盤面に影響しない。禁手は局面のみで決まる）。
 * - 相関対策の層化: 親キー（白 3 石の座標集合）と root 珠型で候補をラウンドロビンに
 *   並べる（seed 固定）。
 *
 * エンジン呼び出し（均衡フィルタ）は gen-opening-suite.ts / -worker.ts 側。
 */
import type { BoardState, Position, StoneColor } from "@/types/game";

import { BOARD_SIZE, TENGEN } from "@/constants";
import { D4_TRANSFORMS } from "@/logic/boardSymmetry";
import { getAllJushuNames, getJushuPositions } from "@/logic/cpu/opening";
import { formatMove } from "@/logic/gameRecordParser";

import { mulberry32 } from "./mulberry32.ts";

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

export type SideToMove = "black" | "white";

/** スイート候補（層化順序付けの入力）。key はブックの entries キー。 */
export interface SuiteCandidate {
  key: string;
  parent: string;
  root: string | null;
}

export interface CandidateOrderOptions {
  seed: number;
  /** 親（白 3 石構成）ごとの上限件数 */
  parentCap: number;
}

/**
 * ブックのキー（`boardToString(board)|side`）を盤面と手番に戻す。
 * boardToString と同じく行優先・row 0 が上端（15 段目）。
 */
export function parseBoardKey(key: string): {
  board: BoardState;
  sideToMove: SideToMove;
} {
  const sep = key.lastIndexOf("|");
  if (sep < 0) {
    throw new Error(`キーに手番区切り '|' がない: ${key.slice(0, 40)}...`);
  }
  const cells = key.slice(0, sep);
  const side = key.slice(sep + 1);
  if (side !== "black" && side !== "white") {
    throw new Error(`手番が不正: ${side}`);
  }
  if (cells.length !== CELL_COUNT) {
    throw new Error(`盤面文字列の長さが ${CELL_COUNT} でない: ${cells.length}`);
  }
  const board: BoardState = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    const line: StoneColor[] = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      const ch = cells[row * BOARD_SIZE + col];
      line.push(charToCell(ch));
    }
    board.push(line);
  }
  return { board, sideToMove: side };
}

function charToCell(ch: string | undefined): StoneColor {
  switch (ch) {
    case "B":
      return "black";
    case "W":
      return "white";
    case ".":
      return null;
    default:
      throw new Error(`盤面文字が不正: ${String(ch)}`);
  }
}

function countChars(s: string, ch: string): number {
  let n = 0;
  for (const c of s) {
    if (c === ch) {
      n++;
    }
  }
  return n;
}

/** entries のキーのうち、7 石（黒 4・白 3）かつ白番のものだけを残す（入力順を保つ）。 */
export function selectSevenStoneWhiteKeys(keys: string[]): string[] {
  return keys.filter((key) => {
    if (!key.endsWith("|white")) {
      return false;
    }
    const cells = key.slice(0, key.lastIndexOf("|"));
    return countChars(cells, "B") === 4 && countChars(cells, "W") === 3;
  });
}

/** 盤面から色ごとの石座標を行優先で列挙する。 */
function stonesOf(board: BoardState, color: "black" | "white"): Position[] {
  const out: Position[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] === color) {
        out.push({ row, col });
      }
    }
  }
  return out;
}

/**
 * 7 石（黒 4・白 3）局面を、黒から交互に並べた擬似手順に変換する。
 * 各色の石は行優先の並び（決定的）。
 */
export function boardToPseudoMoves(board: BoardState): Position[] {
  const blacks = stonesOf(board, "black");
  const whites = stonesOf(board, "white");
  if (blacks.length !== 4 || whites.length !== 3) {
    throw new Error(
      `7 石局面（黒 4・白 3）でない: 黒 ${blacks.length}・白 ${whites.length}`,
    );
  }
  const moves: Position[] = [];
  for (let i = 0; i < blacks.length; i++) {
    moves.push(blacks[i]!);
    const w = whites[i];
    if (w) {
      moves.push(w);
    }
  }
  return moves;
}

/** 親キー = 白石の表記をソートして空白連結した文字列。 */
export function parentKey(board: BoardState): string {
  return stonesOf(board, "white").map(formatMove).sort().join(" ");
}

/**
 * root 珠型の復元: 26 珠型の 3 石（天元黒・白 2 手目・黒 3 手目）を D4 の 8 変換で
 * 写像し、盤面の部分集合になっている珠型名を返す。複数一致する場合は珠型名
 * リストの先頭（getAllJushuNames の順）。一致しなければ null。
 */
export function detectRootJushu(board: BoardState): string | null {
  if (board[TENGEN.row]?.[TENGEN.col] !== "black") {
    return null;
  }
  for (const name of getAllJushuNames()) {
    const positions = getJushuPositions(name, true);
    if (!positions) {
      continue;
    }
    const [, white2, black3] = positions;
    for (const { transform } of D4_TRANSFORMS) {
      const w = transform(white2.row, white2.col);
      const b = transform(black3.row, black3.col);
      if (
        board[w.row]?.[w.col] === "white" &&
        board[b.row]?.[b.col] === "black"
      ) {
        return name;
      }
    }
  }
  return null;
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** 各グループから 1 件ずつ順に取り出す（ラウンドロビン）。グループ順は入力順。 */
function roundRobin<T>(groups: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const maxLen = groups.reduce((m, g) => Math.max(m, g.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const g of groups) {
      const item = g[i];
      if (item !== undefined) {
        out.push(item);
      }
    }
  }
  return out;
}

/** 初出順を保つグループ化。 */
function groupBy<T>(items: readonly T[], keyOf: (t: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const g = map.get(k);
    if (g) {
      g.push(item);
    } else {
      map.set(k, [item]);
    }
  }
  return [...map.values()];
}

/**
 * 層化順序: seed 固定でシャッフル → 親ごと parentCap 件に切り詰め →
 * root（無ければ "null"）→ 親 → 子 の順でラウンドロビンに並べる。
 * 入力配列は変更しない。
 */
export function buildCandidateOrder(
  items: readonly SuiteCandidate[],
  options: CandidateOrderOptions,
): SuiteCandidate[] {
  const perParent = new Map<string, number>();
  const capped: SuiteCandidate[] = [];
  for (const c of shuffled(items, options.seed)) {
    const n = perParent.get(c.parent) ?? 0;
    if (n >= options.parentCap) {
      continue;
    }
    perParent.set(c.parent, n + 1);
    capped.push(c);
  }
  const byRoot = groupBy(capped, (c) => c.root ?? "null");
  const rootLists = byRoot.map((rootGroup) =>
    roundRobin(groupBy(rootGroup, (c) => c.parent)),
  );
  return roundRobin(rootLists);
}

export type SuiteRejectReason = "score" | "whiteWin" | "blackWin";

/** worker による 1 候補の生評価結果（gen-opening-suite の --raw-out に保存する単位）。 */
export interface RawEvaluation {
  score: number;
  bestMove: string;
  /** 生評価時のしきい値で落ちた場合は "score"。勝ち判定は |score| がしきい値内の候補のみ実施 */
  reject: SuiteRejectReason | null;
  elapsedMs: number;
}

export interface EvaluatedCandidate extends RawEvaluation {
  candidate: SuiteCandidate;
}

export interface SelectOptions {
  scoreAbsMax: number;
  target: number;
}

function classify(
  raw: RawEvaluation,
  candidate: SuiteCandidate,
  scoreAbsMax: number,
): SuiteRejectReason | null {
  if (Math.abs(raw.score) > scoreAbsMax) {
    return "score";
  }
  if (raw.reject === "score") {
    throw new Error(
      `生評価のしきい値で落ちており再判定できない候補（score ${raw.score}）: ${candidate.key}`,
    );
  }
  return raw.reject;
}

/**
 * 候補順序と生評価結果から採否を決める（純粋）。
 * 順に走査し、|score| > scoreAbsMax なら "score"、それ以外は生評価の勝ち判定に従う。
 * accepted が target に達した時点で止める（以降の候補は evaluated に含めない）。
 * 生評価が無い候補、または生評価時のしきい値で落ちていて今のしきい値では
 * 再判定できない候補があれば例外。
 */
export function selectOpenings(
  order: readonly SuiteCandidate[],
  results: ReadonlyMap<string, RawEvaluation>,
  options: SelectOptions,
): { evaluated: EvaluatedCandidate[]; accepted: EvaluatedCandidate[] } {
  const evaluated: EvaluatedCandidate[] = [];
  const accepted: EvaluatedCandidate[] = [];
  for (const candidate of order) {
    if (accepted.length >= options.target) {
      break;
    }
    const raw = results.get(candidate.key);
    if (!raw) {
      throw new Error(`未評価の候補: ${candidate.key}`);
    }
    const e: EvaluatedCandidate = {
      ...raw,
      reject: classify(raw, candidate, options.scoreAbsMax),
      candidate,
    };
    evaluated.push(e);
    if (e.reject === null) {
      accepted.push(e);
    }
  }
  return { evaluated, accepted };
}

export interface PartitionCounts {
  score: number;
  whiteWin: number;
  blackWin: number;
  accepted: number;
}

/**
 * 全候補を生評価で分類し、通過（採用可能）した候補を入力順で返す（純粋）。
 * 全件の生評価が揃っているとき（--from-raw）に、層化順序付けを「採用可能な候補」
 * だけに掛けるための前処理。親上限が評価前の候補数ではなく採用可能数に対して
 * 効くので、親ごとの均等性がそのまま出力に反映される。
 */
export function partitionByRaw(
  candidates: readonly SuiteCandidate[],
  results: ReadonlyMap<string, RawEvaluation>,
  scoreAbsMax: number,
): { eligible: SuiteCandidate[]; counts: PartitionCounts } {
  const counts: PartitionCounts = {
    score: 0,
    whiteWin: 0,
    blackWin: 0,
    accepted: 0,
  };
  const eligible: SuiteCandidate[] = [];
  for (const candidate of candidates) {
    const raw = results.get(candidate.key);
    if (!raw) {
      throw new Error(`未評価の候補: ${candidate.key}`);
    }
    const reject = classify(raw, candidate, scoreAbsMax);
    if (reject === null) {
      counts.accepted++;
      eligible.push(candidate);
    } else {
      counts[reject]++;
    }
  }
  return { eligible, counts };
}
