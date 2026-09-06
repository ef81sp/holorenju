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

import type { OpeningSuitePlyCheckFilter } from "../types/openingSuite.ts";

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

/** 採否規則の SSoT: |score| > しきい値なら "score"、それ以外は生評価の勝ち判定に従う。 */
export function classifyRaw(
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
      reject: classifyRaw(raw, candidate, options.scoreAbsMax),
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
    const reject = classifyRaw(raw, candidate, scoreAbsMax);
    if (reject === null) {
      counts.accepted++;
      eligible.push(candidate);
    } else {
      counts[reject]++;
    }
  }
  return { eligible, counts };
}

/** --raw-out の 1 行。生評価時の設定も残す（再判定可否・再利用可否の判断用）。 */
export interface RawRecord extends RawEvaluation {
  key: string;
  parent: string;
  root: string | null;
  scoreAbsMax: number;
  nodes: number;
  depth: number;
}

/** raw JSONL 全体で共通の生評価設定 */
export interface RawMeta {
  nodes: number;
  depth: number;
  scoreAbsMax: number;
}

/**
 * raw JSONL を results と meta に分ける（純粋）。空行は無視。
 * 行ごとに nodes/depth が食い違う（別設定の評価が混在している）場合は例外。
 * scoreAbsMax は行ごとに異なりうる（再判定可否は classifyRaw が行単位で見る）ので、
 * meta には最後の行の値を入れる。
 */
export function parseRawLines(text: string): {
  results: Map<string, RawEvaluation>;
  meta: RawMeta | null;
} {
  const results = new Map<string, RawEvaluation>();
  let meta: RawMeta | null = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const r = JSON.parse(line) as RawRecord;
    if (meta && (meta.nodes !== r.nodes || meta.depth !== r.depth)) {
      throw new Error(
        `raw の nodes/depth が行ごとに食い違う: ${meta.nodes}/${meta.depth} vs ${r.nodes}/${r.depth}（key ${r.key.slice(0, 20)}...）`,
      );
    }
    meta = { nodes: r.nodes, depth: r.depth, scoreAbsMax: r.scoreAbsMax };
    results.set(r.key, {
      score: r.score,
      bestMove: r.bestMove,
      reject: r.reject,
      elapsedMs: r.elapsedMs,
    });
  }
  return { results, meta };
}

/** CLI の --nodes/--depth が raw の生評価設定と一致することを確認する（黙って古い生評価を再利用しない）。 */
export function assertRawMeta(
  meta: RawMeta,
  opts: { nodes: number; depth: number },
): void {
  if (meta.nodes !== opts.nodes) {
    throw new Error(
      `--nodes=${opts.nodes} が raw の nodes=${meta.nodes} と不一致。raw を再生成するか --nodes を合わせること`,
    );
  }
  if (meta.depth !== opts.depth) {
    throw new Error(
      `--depth=${opts.depth} が raw の depth=${meta.depth} と不一致。raw を再生成するか --depth を合わせること`,
    );
  }
}

// ---------------------------------------------------------------------------
// v2: ply-check（採用可能候補を hard 実機で N 手進め、深さ 7 の根評価では見えない
// 決着済み局面を除く）と、根 score の符号による層化（bench-precision §5.2）
// ---------------------------------------------------------------------------

/** ply-check の 1 手分の記録 */
export interface PlyRecord {
  move: string;
  /** 着手側視点の score */
  score: number;
  completedDepth: number;
}

/** 途中終局の種類: 五連 / 黒の禁手着手 / エンジンが着手を返さなかった */
export type PlyTerminal = "five" | "forbidden" | "noMove";

export interface PlyCheckResult {
  plies: PlyRecord[];
  /** 途中終局していれば種類（最後の ply で終局） */
  terminal: PlyTerminal | null;
  elapsedMs: number;
}

/** ply-check JSONL の 1 行。評価設定も残す（再利用可否の判断用）。 */
export interface PlyCheckRecord extends PlyCheckResult {
  key: string;
  rootScore: number;
  pliesRequested: number;
  nodes: number;
  depth: number;
  timeLimitMs: number;
}

/**
 * ply-check JSONL 全体で共通の評価設定。types の OpeningSuitePlyCheckFilter から導出
 * （しきい値は選抜時に決めるので持たない。手数は JSONL の `plies`（配列）と衝突するため
 * `pliesRequested`）。
 */
export type PlyCheckMeta = Omit<
  OpeningSuitePlyCheckFilter,
  "plyScoreAbsMax" | "plies"
> & { pliesRequested: number };

export type PlyRejectReason = "plyScore" | "terminal" | "incomplete";

/**
 * ply-check の採否（純粋）。終局 → "terminal"、手数不足 → "incomplete"、
 * いずれかの ply で |score| > plyScoreAbsMax → "plyScore"（最初に超えた手数を atPly に、1 始まり）。
 */
export function classifyPlyCheck(
  result: PlyCheckResult,
  opts: { plyScoreAbsMax: number; pliesRequired: number },
): { reject: PlyRejectReason | null; atPly: number | null } {
  if (result.terminal !== null) {
    return { reject: "terminal", atPly: result.plies.length };
  }
  if (result.plies.length < opts.pliesRequired) {
    return { reject: "incomplete", atPly: result.plies.length };
  }
  const idx = result.plies.findIndex(
    (p) => Math.abs(p.score) > opts.plyScoreAbsMax,
  );
  if (idx >= 0) {
    return { reject: "plyScore", atPly: idx + 1 };
  }
  return { reject: null, atPly: null };
}

/** 根が均衡（|root| <= rootScoreAbsMax）なのに N 手以内に |score| > flipScoreAbsMin になったか。 */
export function isHorizonFlip(
  rootScore: number,
  plies: readonly PlyRecord[],
  opts: { rootScoreAbsMax: number; flipScoreAbsMin: number },
): boolean {
  if (Math.abs(rootScore) > opts.rootScoreAbsMax) {
    return false;
  }
  return plies.some((p) => Math.abs(p.score) > opts.flipScoreAbsMin);
}

/** ply-check JSONL を results と meta に分ける（純粋）。設定が行ごとに食い違えば例外。 */
export function parsePlyCheckLines(text: string): {
  results: Map<string, PlyCheckResult>;
  meta: PlyCheckMeta | null;
} {
  const results = new Map<string, PlyCheckResult>();
  let meta: PlyCheckMeta | null = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const r = JSON.parse(line) as PlyCheckRecord;
    const m: PlyCheckMeta = {
      pliesRequested: r.pliesRequested,
      nodes: r.nodes,
      depth: r.depth,
      timeLimitMs: r.timeLimitMs,
    };
    if (meta && JSON.stringify(meta) !== JSON.stringify(m)) {
      throw new Error(
        `ply-check の設定が行ごとに食い違う: ${JSON.stringify(meta)} vs ${JSON.stringify(m)}`,
      );
    }
    meta = m;
    results.set(r.key, {
      plies: r.plies,
      terminal: r.terminal,
      elapsedMs: r.elapsedMs,
    });
  }
  return { results, meta };
}

/** 根 score 付きの候補（符号層化の入力） */
export interface SignedCandidate {
  candidate: SuiteCandidate;
  /** 白番 root score（白視点。負 = 黒有利） */
  rootScore: number;
}

/**
 * 根 score の符号で層化して target 件取る（純粋）。
 * 負側（黒有利）を negativeRatioMin 以上含める。負側が不足なら達成できる比率で
 * 非負側から埋め、非負側が不足なら負側を比率以上に使う。各側の中では入力順
 * （層化順）を保ち、出力は比率に応じて交互に混ぜる（--opening-offset で前後半に
 * 分けても符号比率が偏らないように）。
 */
export function stratifyBySign(
  ordered: readonly SignedCandidate[],
  opts: { target: number; negativeRatioMin: number },
): {
  picked: SignedCandidate[];
  negativeCount: number;
  nonNegativeCount: number;
} {
  const negatives = ordered.filter((c) => c.rootScore < 0);
  const nonNegatives = ordered.filter((c) => c.rootScore >= 0);
  const wantNeg = Math.ceil(opts.target * opts.negativeRatioMin);
  const negQuota = Math.min(
    negatives.length,
    Math.max(wantNeg, opts.target - nonNegatives.length),
  );
  const posQuota = Math.min(nonNegatives.length, opts.target - negQuota);
  const total = negQuota + posQuota;

  // 比率に応じて交互に混ぜる（Bresenham 風: 累積比率が負側の目標比率を下回ったら負側）
  const picked: SignedCandidate[] = [];
  let ni = 0;
  let pi = 0;
  while (picked.length < total) {
    const negShare = total === 0 ? 0 : negQuota / total;
    const takeNeg =
      ni < negQuota && (pi >= posQuota || ni < negShare * (picked.length + 1));
    if (takeNeg) {
      picked.push(negatives[ni]!);
      ni++;
    } else {
      picked.push(nonNegatives[pi]!);
      pi++;
    }
  }
  return { picked, negativeCount: negQuota, nonNegativeCount: posQuota };
}

export interface PickOptions {
  seed: number;
  parentCap: number;
  target: number;
  /** 0 なら符号層化なし（v1 と同じ経路: 層化順序の先頭 target 件） */
  negativeRatioMin: number;
}

/**
 * 採用可能候補から最終採用を決める（純粋）: 親上限付き root→親→子ラウンドロビン →
 * （negativeRatioMin > 0 なら）符号層化 → target 件。
 */
export function pickOpenings(
  eligible: readonly SuiteCandidate[],
  rawResults: ReadonlyMap<string, RawEvaluation>,
  opts: PickOptions,
): {
  picked: SignedCandidate[];
  sign: { negative: number; nonNegative: number } | null;
  ordered: number;
} {
  const order = buildCandidateOrder(eligible, {
    seed: opts.seed,
    parentCap: opts.parentCap,
  });
  const signed: SignedCandidate[] = order.map((c) => {
    const raw = rawResults.get(c.key);
    if (!raw) {
      throw new Error(`未評価の候補: ${c.key}`);
    }
    return { candidate: c, rootScore: raw.score };
  });
  if (opts.negativeRatioMin <= 0) {
    return {
      picked: signed.slice(0, opts.target),
      sign: null,
      ordered: order.length,
    };
  }
  const r = stratifyBySign(signed, {
    target: opts.target,
    negativeRatioMin: opts.negativeRatioMin,
  });
  return {
    picked: r.picked,
    sign: { negative: r.negativeCount, nonNegative: r.nonNegativeCount },
    ordered: order.length,
  };
}
