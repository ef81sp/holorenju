/**
 * 2 つのベンチ結果 JSON の決定性比較（bench-fixed-nodes-2026-09-06.md §2.5
 * 「決定性スモーク」）。pairId + 色で局を突き合わせ、棋譜（着手列）・1 手ごとの
 * `stats.nodes`・`score` の**完全一致**を判定する。不一致は局ごとに最初の手だけ報告する
 * （以降の手は最初のずれに連鎖するので情報量が無い）。
 *
 * 固定ノード（決定的）モードで jobs や負荷を変えて 2 回走らせた結果がここで一致
 * しなければ、探索に壁時計が漏れている。
 */
import type { CommitGameResult } from "../types/commit-bench.ts";

export interface BenchRunLike {
  games: CommitGameResult[];
}

export type MismatchField = "move" | "nodes" | "score" | "length";

export interface GameMismatch {
  pairId: string;
  isABlack: boolean;
  /** moveHistory 上の index（0-based、開局手込み） */
  moveIndex: number;
  field: MismatchField;
  a: string;
  b: string;
}

export interface BenchComparison {
  identical: boolean;
  /** 両方に存在し比較した局数 */
  comparedGames: number;
  mismatches: GameMismatch[];
  /** "pairId/A黒" 形式。B にだけある局 */
  missingInA: string[];
  /** A にだけある局 */
  missingInB: string[];
}

function gameKey(g: CommitGameResult): string {
  if (g.pairId === undefined) {
    throw new Error(
      "pairId の無い旧 JSON は --compare で比較できません（pairId 付きの結果同士を指定してください）",
    );
  }
  return `${g.pairId}/${g.isABlack ? "A黒" : "A白"}`;
}

function indexGames(games: CommitGameResult[]): Map<string, CommitGameResult> {
  const map = new Map<string, CommitGameResult>();
  for (const g of games) {
    map.set(gameKey(g), g);
  }
  return map;
}

function fmt(v: unknown): string {
  return v === undefined ? "n/a" : String(v);
}

/** 1 局を突き合わせ、最初の不一致を返す（一致なら null）。 */
function compareGame(
  a: CommitGameResult,
  b: CommitGameResult,
): GameMismatch | null {
  const { pairId, isABlack } = a;
  const base = { pairId: pairId!, isABlack };
  const n = Math.min(a.moveHistory.length, b.moveHistory.length);
  for (let i = 0; i < n; i++) {
    const ma = a.moveHistory[i]!;
    const mb = b.moveHistory[i]!;
    if (ma.row !== mb.row || ma.col !== mb.col) {
      return {
        ...base,
        moveIndex: i,
        field: "move",
        a: `(${ma.row},${ma.col})`,
        b: `(${mb.row},${mb.col})`,
      };
    }
    if (ma.isOpening) {
      continue;
    }
    const na = ma.stats?.nodes;
    const nb = mb.stats?.nodes;
    if (na !== nb) {
      return { ...base, moveIndex: i, field: "nodes", a: fmt(na), b: fmt(nb) };
    }
    if (ma.score !== mb.score) {
      return {
        ...base,
        moveIndex: i,
        field: "score",
        a: fmt(ma.score),
        b: fmt(mb.score),
      };
    }
  }
  if (a.moveHistory.length !== b.moveHistory.length) {
    return {
      ...base,
      moveIndex: n,
      field: "length",
      a: `${a.moveHistory.length}手`,
      b: `${b.moveHistory.length}手`,
    };
  }
  return null;
}

export function compareBenchRuns(
  runA: BenchRunLike,
  runB: BenchRunLike,
): BenchComparison {
  const mapA = indexGames(runA.games);
  const mapB = indexGames(runB.games);
  const mismatches: GameMismatch[] = [];
  const missingInB: string[] = [];
  const missingInA: string[] = [];
  let comparedGames = 0;
  for (const [key, ga] of mapA) {
    const gb = mapB.get(key);
    if (!gb) {
      missingInB.push(key);
      continue;
    }
    comparedGames++;
    const mm = compareGame(ga, gb);
    if (mm) {
      mismatches.push(mm);
    }
  }
  for (const key of mapB.keys()) {
    if (!mapA.has(key)) {
      missingInA.push(key);
    }
  }
  return {
    identical:
      mismatches.length === 0 &&
      missingInA.length === 0 &&
      missingInB.length === 0,
    comparedGames,
    mismatches,
    missingInA,
    missingInB,
  };
}

export function formatBenchComparison(r: BenchComparison): string {
  const lines: string[] = [];
  if (r.identical) {
    lines.push(
      `✓ 完全一致: ${r.comparedGames} 局の棋譜・1 手ごとの nodes・score が全て同じ`,
    );
    return lines.join("\n");
  }
  const missingA =
    r.missingInA.length > 0 ? ` / A に無い局 ${r.missingInA.length}` : "";
  const missingB =
    r.missingInB.length > 0 ? ` / B に無い局 ${r.missingInB.length}` : "";
  lines.push(
    `✗ 不一致: 比較 ${r.comparedGames} 局のうち ${r.mismatches.length} 局にずれ${missingA}${missingB}`,
  );
  for (const m of r.mismatches) {
    lines.push(
      `  ${m.pairId} ${m.isABlack ? "A黒" : "A白"} move#${m.moveIndex + 1} ${m.field}: A=${m.a} B=${m.b}`,
    );
  }
  for (const k of r.missingInA) {
    lines.push(`  A に無い: ${k}`);
  }
  for (const k of r.missingInB) {
    lines.push(`  B に無い: ${k}`);
  }
  return lines.join("\n");
}
