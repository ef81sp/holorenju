/**
 * 複数のベンチ結果 JSON の games を結合する（`bench:reanalyze --merge`）。
 *
 * 二段階スクリーン（strength-screen-2026-09-08.md §1）の前半（`--max-games=382`）と
 * 後半（`--opening-offset=191`）を連結して 1 つのペア統計を出すためのもの。
 * 決定的モードでは前半＋後半の連結が全量 1 ランとビット一致するので、統計上は
 * 1 本の結果として扱える。
 *
 * 結合できる条件（違えば throw）:
 *   - type（commit-bench / weight-bench）が同じ
 *   - commitA / commitB の sha が同じ（commit-bench）、weights が同じ（weight-bench）
 *   - config のうち強さに効く設定が同じ（difficulty / fixedNodes 系 / randomFactor /
 *     evalOptions / book / threatProbe / maxNodes / maxDepth / openings.file・version）。
 *     openings.offset と sets・sprt は前後半で当然違うので比較しない
 *   - 同じ pairId+色 の局が複数の JSON に現れない（前後半が重なっていない）
 *   - いずれの run も valid !== false（決定的モードで abort が出たランはビット一致の
 *     前提が崩れているので連結しない）
 *
 * seed は比較しない: 非決定的モード（randomFactor>0）では前後半の連結は
 * 「1 ラン」と等価にならないので、そもそも --merge の対象は決定的モードの結果。
 */
import { readFileSync } from "node:fs";

import type { WeightBenchResult } from "../types/ab.ts";
import type {
  CommitBenchResult,
  CommitGameResult,
} from "../types/commit-bench.ts";

/** 再集計対象の JSON 形（旧 JSON は新フィールドを欠くので Partial）。 */
export type MergeableBenchJson =
  | Partial<CommitBenchResult>
  | Partial<WeightBenchResult>;

export interface MergedBenchRun {
  games: CommitGameResult[];
  /** 結合元の識別（ヘッダ表示用） */
  header: string;
}

/**
 * 強さに効く config キー（前後半で一致していなければならない）。
 * **強さに効くキーを config に追加したらここにも足す。**
 * searchFeaturesA/B は wasm の機能ビット。weight-bench は同一 worktree の wasm を
 * 使うので、前後半の間に再ビルドが混入したことの検出になる。
 */
const COMPARED_CONFIG_KEYS = [
  "difficulty",
  "fixedNodes",
  "fixedNodesA",
  "fixedNodesB",
  "randomFactor",
  "evalOptionsA",
  "evalOptionsB",
  "bookA",
  "bookB",
  "threatProbeA",
  "threatProbeB",
  "maxNodesA",
  "maxNodesB",
  "maxDepthA",
  "maxDepthB",
  "searchFeaturesA",
  "searchFeaturesB",
] as const satisfies readonly (keyof CommitBenchResult["config"])[];

/** キー順に依存しない stringify（weights 等の Record 比較用）。 */
function stable(v: unknown): string {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const rec = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(rec).sort()) {
      sorted[k] = rec[k];
    }
    return JSON.stringify(sorted);
  }
  return JSON.stringify(v ?? null);
}

function configOf(json: MergeableBenchJson): Record<string, unknown> {
  return (json.config ?? {}) as Record<string, unknown>;
}

function openingsIdentity(json: MergeableBenchJson): string {
  const o = json.config?.openings;
  return o
    ? stable({ file: o.file, version: o.version, count: o.count })
    : "珠型";
}

function assertSame(
  field: string,
  a: unknown,
  b: unknown,
  index: number,
): void {
  if (stable(a) !== stable(b)) {
    throw new Error(
      `--merge: ${field} が一致しません（1 本目 ${stable(a)} / ${index + 1} 本目 ${stable(b)}）`,
    );
  }
}

function assertCompatible(
  first: MergeableBenchJson,
  other: MergeableBenchJson,
  index: number,
): void {
  assertSame("type", first.type, other.type, index);
  if ("commitA" in first || "commitA" in other) {
    const fa = "commitA" in first ? first.commitA : undefined;
    const oa = "commitA" in other ? other.commitA : undefined;
    const fb = "commitB" in first ? first.commitB : undefined;
    const ob = "commitB" in other ? other.commitB : undefined;
    assertSame("commitA", fa?.sha, oa?.sha, index);
    assertSame("commitB", fb?.sha, ob?.sha, index);
  }
  if ("weights" in first || "weights" in other) {
    const fw = "weights" in first ? first.weights : undefined;
    const ow = "weights" in other ? other.weights : undefined;
    assertSame("weights", fw, ow, index);
  }
  const fc = configOf(first);
  const oc = configOf(other);
  for (const key of COMPARED_CONFIG_KEYS) {
    assertSame(`config.${key}`, fc[key], oc[key], index);
  }
  assertSame(
    "config.openings",
    openingsIdentity(first),
    openingsIdentity(other),
    index,
  );
}

function gameKey(g: CommitGameResult): string {
  return `${g.pairId ?? g.jushuName}/${g.isABlack ? "A黒" : "A白"}`;
}

/** 結果 JSON を読む（bench-reanalyze の全モードで共用）。 */
export function readBenchJson(file: string): MergeableBenchJson {
  return JSON.parse(readFileSync(file, "utf8")) as MergeableBenchJson;
}

export function mergeBenchRuns(runs: MergeableBenchJson[]): MergedBenchRun {
  const [first] = runs;
  if (!first) {
    throw new Error("--merge: 結果 JSON を 1 本以上指定してください");
  }
  const games: CommitGameResult[] = [];
  const seen = new Set<string>();
  runs.forEach((json, index) => {
    if (json.valid === false) {
      throw new Error(
        `--merge: ${index + 1} 本目は valid=false（abort 等で決定性が崩れたラン）なので連結できません`,
      );
    }
    if (index > 0) {
      assertCompatible(first, json, index);
    }
    if (!Array.isArray(json.games) || json.games.length === 0) {
      throw new Error(`--merge: ${index + 1} 本目に games がありません`);
    }
    for (const g of json.games) {
      const key = gameKey(g);
      if (seen.has(key)) {
        throw new Error(
          `--merge: 局 ${key} が複数の JSON に含まれています（前後半が重なっていないか確認）`,
        );
      }
      seen.add(key);
      games.push(g);
    }
  });
  const head: string[] = [`merged ${runs.length} runs`];
  if (first.type) {
    head.push(first.type);
  }
  if ("commitA" in first && first.commitA && first.commitB) {
    head.push(`A=${first.commitA.shortSha} B=${first.commitB.shortSha}`);
  }
  if ("weights" in first && first.weights) {
    head.push(`weights=${stable(first.weights)}`);
  }
  const c = first.config;
  if (c) {
    head.push(`difficulty=${c.difficulty}`);
    if (c.fixedNodes !== undefined) {
      head.push(`fixedNodes=${c.fixedNodes}`);
    }
    if (c.openings) {
      head.push(`openings=${c.openings.file}`);
    }
  }
  return { games, header: head.join(" | ") };
}
