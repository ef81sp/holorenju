/**
 * prospect コーパス JSONL の消費側（prospect-texel.ts / prospect-anchor.ts）の共通部。
 *
 * - `readCorpusRows`: JSONL を読み、ラベラーの破棄行（`dropped`）を除く。
 * - 源の選別（`--include-source` / `--exclude-source` / `--holdout`）。トークンは
 *   kind（`kifu` / `book` / `prefix`）か月単位セグメント（`kifu/2026-06`、segmentKey と同形式）。
 * - 源 kind × 月（kifu はファイル名の YYYY-MM、book/prefix は月なし）のセグメントと、
 *   fold 平均 val 損失・holdout 損失のセグメント集計（eval-r4-2026-09-11.md §3 (i) / §4）。
 */

import { readFileSync } from "node:fs";

import {
  CORPUS_SOURCE_KINDS,
  type CorpusRow,
  type CorpusSource,
  type CorpusSourceKind,
} from "../types/prospectCorpus.ts";
import { type Fold, meanSquaredLoss } from "./texelFit.ts";

/** JSONL を読み込み、破棄行（dropped フィールド持ち）を除いて返す。source.kind の無い行（旧形式）は例外。 */
export function readCorpusRows(path: string): CorpusRow[] {
  const text = readFileSync(path, "utf8");
  const rows: CorpusRow[] = [];
  text.split("\n").forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const row = JSON.parse(trimmed) as CorpusRow;
    if (row.dropped !== undefined) {
      return;
    }
    if (!isSourceKind(row.source?.kind as string | undefined)) {
      throw new Error(
        `${path}:${i + 1}: source.kind が無いか不正（旧形式の JSONL。prospect-corpus.ts で再生成すること）`,
      );
    }
    rows.push(row);
  });
  return rows;
}

/** ファイル名の日付（`commit-bench-2026-06-10T...` → `2026-06`）。無ければ null。 */
export function sourceMonth(file: string): string | null {
  const m = /(\d{4}-\d{2})/.exec(file);
  return m ? m[1]! : null;
}

/** 源 kind × 月のセグメントキー。kifu は `kifu/YYYY-MM`（日付なしは `kifu/-`）、book/prefix は kind のみ。 */
export function segmentKey(source: CorpusSource): string {
  if (source.kind !== "kifu") {
    return source.kind;
  }
  return `kifu/${sourceMonth(source.file) ?? "-"}`;
}

function isSourceKind(s: string | undefined): s is CorpusSourceKind {
  return (
    s !== undefined && (CORPUS_SOURCE_KINDS as readonly string[]).includes(s)
  );
}

const MONTH_SEGMENT_RE = /^kifu\/\d{4}-\d{2}$/;

/** 選別トークン: kind（`kifu`）または月単位セグメント（`kifu/2026-06`）。 */
export function isSelectorToken(s: string): boolean {
  return isSourceKind(s) || MONTH_SEGMENT_RE.test(s);
}

/** `kifu,book,kifu/2026-06` 形式をトークン配列にする。未指定は空配列。不明なトークンは例外。 */
export function parseSelectorList(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      if (!isSelectorToken(s)) {
        throw new Error(
          `不明な源トークン: "${s}"（${CORPUS_SOURCE_KINDS.join("|")} または kifu/YYYY-MM）`,
        );
      }
      return s;
    });
}

/** 行がトークンに該当するか（kind 一致、または月単位セグメント一致）。 */
export function matchesSelector(
  source: CorpusSource,
  tokens: readonly string[],
): boolean {
  return tokens.some((t) => t === source.kind || t === segmentKey(source));
}

/** include（空なら全行）に該当し、exclude に該当しない行を返す。 */
export function filterRowsBySelector(
  rows: readonly CorpusRow[],
  include: readonly string[],
  exclude: readonly string[],
): CorpusRow[] {
  return rows.filter(
    (r) =>
      (include.length === 0 || matchesSelector(r.source, include)) &&
      !matchesSelector(r.source, exclude),
  );
}

export interface SegmentLossSummary {
  segment: string;
  rowCount: number;
  /** 全行（train/val を問わず）に baseline 重みを当てた損失。 */
  baselineLoss: number;
  /** 各 fold の val に含まれる当該セグメント行の損失（その fold の fit 重み）を fold 平均したもの。 */
  avgValLoss: number | null;
  /** avgValLoss に寄与した fold 数。 */
  foldCount: number;
}

export interface SegmentLossInput {
  /** 行ごとのセグメントキー（X / labels と同じ並び）。 */
  segments: readonly string[];
  X: readonly number[][];
  labels: readonly number[];
  folds: readonly Fold[];
  /** fold ごとの fit 重み（folds と同じ並び）。 */
  foldWeights: readonly number[][];
  baselineWeights: readonly number[];
  K: number;
}

function lossOfIndices(
  input: SegmentLossInput,
  indices: readonly number[],
  weights: readonly number[],
): number {
  return meanSquaredLoss(
    indices.map((i) => input.X[i]!),
    indices.map((i) => input.labels[i]!),
    [...weights],
    input.K,
  );
}

/** セグメント（初出順）ごとに baseline 損失と fold 平均 val 損失を集計する（純粋）。 */
export function summarizeSegmentLoss(
  input: SegmentLossInput,
): SegmentLossSummary[] {
  const out: SegmentLossSummary[] = [];
  for (const [segment, indices] of groupIndicesBySegment(input.segments)) {
    const members = new Set(indices);
    let valSum = 0;
    let foldCount = 0;
    input.folds.forEach((fold, f) => {
      const valIdx = fold.val.filter((i) => members.has(i));
      if (valIdx.length === 0) {
        return;
      }
      valSum += lossOfIndices(input, valIdx, input.foldWeights[f]!);
      foldCount++;
    });
    out.push({
      segment,
      rowCount: indices.length,
      baselineLoss: lossOfIndices(input, indices, input.baselineWeights),
      avgValLoss: foldCount > 0 ? valSum / foldCount : null,
      foldCount,
    });
  }
  return out;
}

export interface HoldoutSegmentSummary {
  segment: string;
  rowCount: number;
  /** baseline 重み（PROSPECT_SCORE_DEFAULT）での損失 */
  baselineLoss: number;
  /** 学習行の final fit 重みでの損失 */
  finalLoss: number;
}

export interface HoldoutLossInput {
  segments: readonly string[];
  X: readonly number[][];
  labels: readonly number[];
  baselineWeights: readonly number[];
  finalWeights: readonly number[];
  K: number;
}

function groupIndicesBySegment(
  segments: readonly string[],
): Map<string, number[]> {
  const bySegment = new Map<string, number[]>();
  segments.forEach((seg, i) => {
    const list = bySegment.get(seg);
    if (list) {
      list.push(i);
    } else {
      bySegment.set(seg, [i]);
    }
  });
  return bySegment;
}

/** holdout 行（学習に使わなかった行）をセグメント（初出順）ごとに final fit 重みで評価する（純粋）。 */
export function summarizeHoldoutLoss(
  input: HoldoutLossInput,
): HoldoutSegmentSummary[] {
  const lossOf = (indices: number[], weights: readonly number[]): number =>
    meanSquaredLoss(
      indices.map((i) => input.X[i]!),
      indices.map((i) => input.labels[i]!),
      [...weights],
      input.K,
    );
  const out: HoldoutSegmentSummary[] = [];
  for (const [segment, indices] of groupIndicesBySegment(input.segments)) {
    out.push({
      segment,
      rowCount: indices.length,
      baselineLoss: lossOf(indices, input.baselineWeights),
      finalLoss: lossOf(indices, input.finalWeights),
    });
  }
  return out;
}

/** holdout セグメント損失の表。 */
export function formatHoldoutLoss(
  summaries: readonly HoldoutSegmentSummary[],
): string {
  const lines = [
    `${"segment".padEnd(14)}${"rows".padStart(8)}${"baseline".padStart(11)}${"final".padStart(11)}`,
  ];
  for (const s of summaries) {
    lines.push(
      `${s.segment.padEnd(14)}${String(s.rowCount).padStart(8)}${s.baselineLoss.toFixed(6).padStart(11)}${s.finalLoss.toFixed(6).padStart(11)}`,
    );
  }
  return lines.join("\n");
}

/** セグメント損失の表。 */
export function formatSegmentLoss(
  summaries: readonly SegmentLossSummary[],
): string {
  const fmt = (v: number | null): string => (v === null ? "-" : v.toFixed(6));
  const lines = [
    `${"segment".padEnd(14)}${"rows".padStart(8)}${"baseline".padStart(11)}${"val(avg)".padStart(11)}${"folds".padStart(7)}`,
  ];
  for (const s of summaries) {
    lines.push(
      `${s.segment.padEnd(14)}${String(s.rowCount).padStart(8)}${fmt(s.baselineLoss).padStart(11)}${fmt(s.avgValLoss).padStart(11)}${String(s.foldCount).padStart(7)}`,
    );
  }
  return lines.join("\n");
}
