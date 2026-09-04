/**
 * 開局スイート JSON（scripts/types/openingSuite.ts）を読み、ベンチのタスク生成が
 * 使う OpeningSource[] に変換する（bench-precision-2026-09-04.md §2.2）。
 *
 * moves の表記・パースは src/logic/gameRecordParser.ts の parseMove を使う
 * （左下原点、"H8" = row 7, col 7）。ここでは表記の検証と重複チェックだけ足す。
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { Position } from "../../src/types/game.ts";
import type {
  OpeningSuiteEntry,
  OpeningSuiteFile,
} from "../types/openingSuite.ts";
import type { OpeningSource } from "./match.ts";

import { BOARD_SIZE } from "../../src/constants/index.ts";
import { parseMove } from "../../src/logic/gameRecordParser.ts";

const MOVE_RE = /^[A-O](?:1[0-5]|[1-9])$/;

/** 読み込んだスイート（ベンチ側が config.openings とタスク生成に使う）。 */
export interface LoadedOpeningSuite {
  /** CLI に渡されたパス（そのまま。結果 JSON に記録する） */
  file: string;
  version: number;
  /** スイート内の開局数（offset 適用前） */
  count: number;
  openings: OpeningSource[];
}

/**
 * "H8 I9 G7 ..." を Position[] に変換する（黒から交互）。
 * 表記不正・盤外・重複・空は例外。
 */
export function parseOpeningMoves(moves: string): Position[] {
  const tokens = moves
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    throw new Error("moves が空");
  }
  const out: Position[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!MOVE_RE.test(token)) {
      throw new Error(`不正な座標表記: ${token}`);
    }
    const pos = parseMove(token);
    if (
      pos.row < 0 ||
      pos.row >= BOARD_SIZE ||
      pos.col < 0 ||
      pos.col >= BOARD_SIZE
    ) {
      throw new Error(`不正な座標（盤外）: ${token}`);
    }
    const key = `${pos.row},${pos.col}`;
    if (seen.has(key)) {
      throw new Error(`座標の重複: ${token}`);
    }
    seen.add(key);
    out.push(pos);
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseEntry(raw: unknown, index: number): OpeningSuiteEntry {
  if (!isRecord(raw)) {
    throw new Error(`openings[${index}] がオブジェクトでない`);
  }
  const { id, moves } = raw;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`openings[${index}].id が文字列でない`);
  }
  if (typeof moves !== "string") {
    throw new Error(`openings[${index}] (${id}).moves が文字列でない`);
  }
  return {
    id,
    root: typeof raw.root === "string" ? raw.root : null,
    parent: typeof raw.parent === "string" ? raw.parent : "",
    moves,
    score: typeof raw.score === "number" ? raw.score : Number.NaN,
  };
}

/**
 * スイート JSON（パース済み unknown）を検証して OpeningSource[] に変換する（純粋）。
 * version 欠落・openings 非配列・空・id 重複・moves 不正は例外。
 */
export function parseOpeningSuite(raw: unknown): {
  version: number;
  openings: OpeningSource[];
} {
  if (!isRecord(raw)) {
    throw new Error("スイート JSON がオブジェクトでない");
  }
  const { version, openings } = raw as Partial<OpeningSuiteFile>;
  if (typeof version !== "number") {
    throw new Error("version が数値でない");
  }
  if (!Array.isArray(openings)) {
    throw new Error("openings が配列でない");
  }
  if (openings.length === 0) {
    throw new Error("openings が空");
  }
  const seen = new Set<string>();
  const out: OpeningSource[] = openings.map((entryRaw, i) => {
    const entry = parseEntry(entryRaw, i);
    if (seen.has(entry.id)) {
      throw new Error(`id の重複: ${entry.id}`);
    }
    seen.add(entry.id);
    try {
      return { id: entry.id, positions: parseOpeningMoves(entry.moves) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`openings[${i}] (${entry.id}): ${msg}`, { cause: err });
    }
  });
  return { version, openings: out };
}

function readSuiteText(abs: string, label: string): string {
  try {
    return fs.readFileSync(abs, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`開局スイートを読めない: ${label} (${msg})`, {
      cause: err,
    });
  }
}

function parseSuiteJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`開局スイートの JSON が不正: ${label} (${msg})`, {
      cause: err,
    });
  }
}

/**
 * `--openings=<file>` を読む。相対パスは rootDir（リポジトリルート）基準。
 */
export function loadOpeningSuite(
  file: string,
  rootDir: string,
): LoadedOpeningSuite {
  const abs = path.isAbsolute(file) ? file : path.resolve(rootDir, file);
  const text = readSuiteText(abs, file);
  const json = parseSuiteJson(text, file);
  const { version, openings } = parseOpeningSuite(json);
  return { file, version, count: openings.length, openings };
}
