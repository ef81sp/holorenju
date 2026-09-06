/**
 * gen-opening-suite.ts の stderr レポート（純粋: 行の配列を返す）。
 */
import type {
  OpeningSuiteEntry,
  OpeningSuiteParentStats,
} from "../types/openingSuite.ts";
import type { EvaluatedCandidate } from "./openingSuite.ts";

const SCORE_BINS: [string, (s: number) => boolean][] = [
  ["<= -1000", (s) => s <= -1000],
  ["-999..-500", (s) => s > -1000 && s <= -500],
  ["-499..-300", (s) => s > -500 && s <= -300],
  ["-299..-200", (s) => s > -300 && s <= -200],
  ["-199..-100", (s) => s > -200 && s <= -100],
  ["-99..-1", (s) => s > -100 && s < 0],
  ["0..99", (s) => s >= 0 && s < 100],
  ["100..199", (s) => s >= 100 && s < 200],
  ["200..299", (s) => s >= 200 && s < 300],
  ["300..499", (s) => s >= 300 && s < 500],
  ["500..999", (s) => s >= 500 && s < 1000],
  [">= 1000", (s) => s >= 1000],
];

const pad = (n: number, w: number): string => String(n).padStart(w);

/** 白番 root スコアのヒストグラム（採用 / 白勝ち棄却 / 黒勝ち棄却 / スコア棄却）としきい値別件数 */
export function histogramLines(
  evaluated: readonly EvaluatedCandidate[],
  scoreAbsMax: number,
): string[] {
  const lines: string[] = [
    "",
    "白番 root スコアのヒストグラム（評価済み候補、採用 / 白勝ち棄却 / 黒勝ち棄却 / スコア棄却）:",
  ];
  for (const [label, pred] of SCORE_BINS) {
    const inBin = evaluated.filter((e) => pred(e.score));
    const n = (r: EvaluatedCandidate["reject"]): number =>
      inBin.filter((e) => e.reject === r).length;
    lines.push(
      `  ${label.padStart(11)}: ${pad(inBin.length, 5)}  acc ${pad(n(null), 4)}  wWin ${pad(n("whiteWin"), 4)}  bWin ${pad(n("blackWin"), 4)}  score ${pad(n("score"), 4)}`,
    );
  }
  lines.push(
    "",
    `しきい値別の件数（<= ${scoreAbsMax} は採用数、それ以上は |score| 条件のみ通過する数）:`,
  );
  for (const t of [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000]) {
    const within = evaluated.filter((e) => Math.abs(e.score) <= t);
    lines.push(
      t <= scoreAbsMax
        ? `  |score| <= ${pad(t, 4)}: accepted ${within.filter((e) => e.reject === null).length}`
        : `  |score| <= ${pad(t, 4)}: score-pass ${within.length}`,
    );
  }
  return lines;
}

function countBy<T>(
  items: readonly T[],
  f: (t: T) => string,
): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = f(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** 採用分の親分布（stats.parents 用） */
export function parentStats(
  openings: readonly OpeningSuiteEntry[],
): OpeningSuiteParentStats {
  const parents = countBy(openings, (o) => o.parent);
  const histogram: Record<string, number> = {};
  for (const [, n] of parents) {
    histogram[String(n)] = (histogram[String(n)] ?? 0) + 1;
  }
  return { count: parents.length, histogram };
}

/** root 珠型と親の分布 */
export function distributionLines(
  openings: readonly OpeningSuiteEntry[],
): string[] {
  const roots = countBy(openings, (o) => o.root ?? "null");
  const { count, histogram } = parentStats(openings);
  return [
    "",
    `root 珠型の分布（${roots.length} 種）:`,
    `  ${roots.map(([k, n]) => `${k}=${n}`).join(", ")}`,
    `親（白 3 石）の分布: ${count} 親`,
    `  親あたり件数: ${Object.entries(histogram)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([n, c]) => `${n}件×${c}親`)
      .join(", ")}`,
  ];
}

/** 1 件あたり秒数の分位点 */
export function timingLine(elapsedMsList: readonly number[]): string | null {
  if (elapsedMsList.length === 0) {
    return null;
  }
  const t = [...elapsedMsList].sort((a, b) => a - b);
  const q = (p: number): string =>
    (t[Math.min(t.length - 1, Math.floor(t.length * p))]! / 1000).toFixed(1);
  return `1 件あたり秒数 p50 ${q(0.5)} / p90 ${q(0.9)} / max ${q(1)}`;
}
