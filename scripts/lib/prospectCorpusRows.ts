/**
 * prospect コーパス JSONL の消費側（prospect-texel.ts / prospect-anchor.ts）の共通部。
 *
 * - `readCorpusRows`: JSONL を読み、ラベラーの破棄行（`dropped`）を除く。
 * - 源 kind の選別（`--include-source` / `--exclude-source`）。
 * - 源 kind × 月（kifu はファイル名の YYYY-MM、book/prefix は月なし）のセグメントと、
 *   fold 平均 val 損失のセグメント集計（eval-r4-2026-09-11.md §3 (i) / §4 の診断用）。
 */

import { readFileSync } from "node:fs";

import type {
  CorpusRow,
  CorpusSource,
  CorpusSourceKind,
} from "../types/prospectCorpus.ts";

import { type Fold, meanSquaredLoss } from "./texelFit.ts";

const SOURCE_KINDS: readonly CorpusSourceKind[] = ["kifu", "book", "prefix"];

/** JSONL を読み込み、破棄行（dropped フィールド持ち）を除いて返す。 */
export function readCorpusRows(path: string): CorpusRow[] {
  const text = readFileSync(path, "utf8");
  const rows: CorpusRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const row = JSON.parse(trimmed) as CorpusRow;
    if (row.dropped !== undefined) {
      continue;
    }
    rows.push(row);
  }
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

function isSourceKind(s: string): s is CorpusSourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(s);
}

/** `kifu,book` 形式を kind の配列にする。未指定は空配列。不明な kind は例外。 */
export function parseKindList(raw: string | undefined): CorpusSourceKind[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      if (!isSourceKind(s)) {
        throw new Error(
          `不明な源 kind: "${s}"（${SOURCE_KINDS.join("|")} のいずれか）`,
        );
      }
      return s;
    });
}

/** include（空なら全 kind）に含まれ、exclude に含まれない行を返す。 */
export function filterRowsBySourceKind(
  rows: readonly CorpusRow[],
  include: readonly CorpusSourceKind[],
  exclude: readonly CorpusSourceKind[],
): CorpusRow[] {
  return rows.filter(
    (r) =>
      (include.length === 0 || include.includes(r.source.kind)) &&
      !exclude.includes(r.source.kind),
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
  const bySegment = new Map<string, number[]>();
  input.segments.forEach((seg, i) => {
    const list = bySegment.get(seg);
    if (list) {
      list.push(i);
    } else {
      bySegment.set(seg, [i]);
    }
  });

  const out: SegmentLossSummary[] = [];
  for (const [segment, indices] of bySegment) {
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
