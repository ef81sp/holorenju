/**
 * 探索プロファイリングスクリプト
 *
 * 特定の局面で iterative deepening を実行し、
 * 各関数の累積時間と呼び出し回数を depth 別に出力する。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/profile-search.ts
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/profile-search.ts --depth=6
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/profile-search.ts --record="H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9 J11 G10 H7 F10 E10 H6 I5 G6 F5"
 */

import type { EvaluationOptions } from "../src/logic/cpu/evaluation/patternScores.ts";
import type { BoardState } from "../src/types/game.ts";

import {
  clearForbiddenCache,
  setCurrentBoardHash,
} from "../src/logic/cpu/cache/forbiddenCache.ts";
import { buildLineTable } from "../src/logic/cpu/lineTable/lineTable.ts";
import { generateSortedMoves } from "../src/logic/cpu/moveGenerator.ts";
import {
  getCounters,
  resetCounters,
  setProfilingEnabled,
  type TimingEntry,
} from "../src/logic/cpu/profiling/counters.ts";
import { createSearchContext } from "../src/logic/cpu/search/context.ts";
import { findBestMoveWithTT } from "../src/logic/cpu/search/minimaxCore.ts";
import { findPreSearchMove } from "../src/logic/cpu/search/preSearch.ts";
import { ASPIRATION_WINDOW } from "../src/logic/cpu/search/techniques.ts";
import { globalTT } from "../src/logic/cpu/transpositionTable.ts";
import { computeBoardHash } from "../src/logic/cpu/zobrist.ts";
import { DIFFICULTY_PARAMS } from "../src/types/cpu.ts";
import { loadPosition, formatPositionSummary } from "./lib/positionLoader.ts";

// =============================================================================
// CLI引数パース
// =============================================================================

interface CliOptions {
  record: string;
  maxDepth: number;
  upToMove?: number;
  skipPreSearch: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  // デフォルト: 中盤20手目の棋譜
  let record =
    "H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9 J11 G10 H7 F10 E10 H6 I5 G6 F5";
  let maxDepth = 6;
  let upToMove: number | undefined = undefined;
  let skipPreSearch = false;

  for (const arg of args) {
    if (arg.startsWith("--record=")) {
      record = arg.slice("--record=".length);
    } else if (arg.startsWith("--depth=")) {
      maxDepth = parseInt(arg.slice("--depth=".length), 10);
    } else if (arg.startsWith("--move=")) {
      upToMove = parseInt(arg.slice("--move=".length), 10);
    } else if (arg === "--skip-presearch") {
      skipPreSearch = true;
    }
  }

  return { record, maxDepth, upToMove, skipPreSearch };
}

// =============================================================================
// プロファイリング実行
// =============================================================================

interface DepthProfile {
  depth: number;
  totalMs: number;
  nodes: number;
  nps: number;
  timings: Record<string, TimingEntry>;
}

function profileDepth(
  board: BoardState,
  color: "black" | "white",
  depth: number,
  evaluationOptions: EvaluationOptions,
  moves: import("../src/types/game.ts").Position[],
): DepthProfile {
  // カウンターリセット
  resetCounters();
  setProfilingEnabled(true);

  // コンテキスト作成
  const ctx = createSearchContext(globalTT, evaluationOptions);
  ctx.lineTable = buildLineTable(board);

  // 禁手キャッシュクリア
  clearForbiddenCache();
  const hash = computeBoardHash(board);
  setCurrentBoardHash(hash);
  ctx.tt.newGeneration();

  // 時間制限なし（depth固定で完走させる）
  ctx.deadline = undefined;
  ctx.timeoutFlag = false;
  ctx.maxNodes = undefined;
  ctx.nodeCountExceeded = false;
  ctx.absoluteDeadline = undefined;
  ctx.absoluteDeadlineExceeded = false;

  const start = performance.now();

  // 深さ1から反復的に探索（TTを温める）
  let prevScore: number | undefined = undefined;
  for (let d = 1; d <= depth; d++) {
    const aspiration =
      prevScore === undefined
        ? undefined
        : { previousScore: prevScore, windowSize: ASPIRATION_WINDOW };

    const result = findBestMoveWithTT(
      board,
      color,
      d,
      0,
      ctx,
      aspiration,
      moves,
    );
    prevScore = result.score;
  }

  const totalMs = performance.now() - start;
  const counters = getCounters();

  setProfilingEnabled(false);

  return {
    depth,
    totalMs,
    nodes: ctx.stats.nodes,
    nps: Math.round(ctx.stats.nodes / (totalMs / 1000)),
    timings: { ...counters.timings },
  };
}

// =============================================================================
// 出力フォーマット
// =============================================================================

function formatTimingRow(
  name: string,
  entry: TimingEntry,
  totalMs: number,
): string {
  const pct = totalMs > 0 ? ((entry.totalMs / totalMs) * 100).toFixed(1) : "0";
  const avgUs =
    entry.calls > 0 ? ((entry.totalMs / entry.calls) * 1000).toFixed(2) : "N/A";
  return `  ${name.padEnd(25)} ${String(entry.calls).padStart(10)}  ${entry.totalMs.toFixed(1).padStart(10)} ms  ${String(pct).padStart(6)}%  ${String(avgUs).padStart(10)} µs/call`;
}

function printProfile(profile: DepthProfile): void {
  console.log(
    `\n── Depth ${profile.depth} ──  ${profile.totalMs.toFixed(0)} ms  ${profile.nodes} nodes  ${profile.nps} NPS`,
  );
  console.log(
    `  ${"Function".padEnd(25)} ${"Calls".padStart(10)}  ${"Total".padStart(13)}  ${"Share".padStart(7)}  ${"Avg".padStart(13)}`,
  );
  console.log(`  ${"─".repeat(75)}`);

  const entries = Object.entries(profile.timings) as [string, TimingEntry][];
  // 時間降順でソート
  entries.sort((a, b) => b[1].totalMs - a[1].totalMs);

  let measuredTotal = 0;
  for (const [name, entry] of entries) {
    if (entry.calls > 0) {
      console.log(formatTimingRow(name, entry, profile.totalMs));
      measuredTotal += entry.totalMs;
    }
  }

  const unmeasured = profile.totalMs - measuredTotal;
  console.log(
    `  ${"(other)".padEnd(25)} ${"".padStart(10)}  ${unmeasured.toFixed(1).padStart(10)} ms  ${((unmeasured / profile.totalMs) * 100).toFixed(1).padStart(6)}%`,
  );
  console.log(
    "  ※ generateSortedMoves は detectOpponentThreats + evaluatePosition を内包（合計>100%は正常）",
  );
}

// =============================================================================
// メイン
// =============================================================================

function main(): void {
  const opts = parseArgs();
  const pos = loadPosition(opts.record, opts.upToMove);

  console.log("=== 探索プロファイリング ===\n");
  console.log(formatPositionSummary(pos));
  console.log(`\n最大探索深度: ${opts.maxDepth}`);

  const hardParams = DIFFICULTY_PARAMS.hard;
  const evaluationOptions: EvaluationOptions = {
    ...hardParams.evaluationOptions,
  };

  // 候補手生成（ルートノード用）
  const ctx = createSearchContext(globalTT, evaluationOptions);
  ctx.lineTable = buildLineTable(pos.board);
  clearForbiddenCache();
  const hash = computeBoardHash(pos.board);
  setCurrentBoardHash(hash);

  let { moves } = generateSortedMoves(pos.board, pos.nextColor, {
    ttMove: null,
    killers: ctx.killers,
    depth: 1,
    history: ctx.history,
    useStaticEval: true,
    evaluationOptions,
  });

  if (!opts.skipPreSearch) {
    // preSearch で必須手チェック
    const preSearch = findPreSearchMove(
      pos.board,
      pos.nextColor,
      ctx,
      evaluationOptions,
      performance.now() + 30000,
    );

    if (preSearch.immediateMove) {
      console.log(
        `\npreSearch で即座に返す手が見つかりました: row=${preSearch.immediateMove.position.row}, col=${preSearch.immediateMove.position.col}`,
      );
      console.log("プロファイリング対象外（--skip-presearch で強制実行可能）");
      return;
    }

    // 候補手制限の適用
    const restrictions = [
      preSearch.restrictedMoves,
      preSearch.openThreeDefenseMoves,
    ];
    for (const restriction of restrictions) {
      if (restriction && restriction.length > 0) {
        const restrictedSet = new Set(
          restriction.map((m) => `${m.row},${m.col}`),
        );
        const filtered = moves.filter((m) =>
          restrictedSet.has(`${m.row},${m.col}`),
        );
        if (filtered.length > 0) {
          moves = filtered;
          break;
        }
      }
    }
  }

  console.log(`候補手数: ${moves.length}`);

  // 各深さでプロファイリング
  const profiles: DepthProfile[] = [];
  for (let depth = 1; depth <= opts.maxDepth; depth++) {
    // TTをクリアして各深さを独立に計測
    globalTT.clear();
    const profile = profileDepth(
      pos.board,
      pos.nextColor,
      depth,
      evaluationOptions,
      moves,
    );
    profiles.push(profile);
    printProfile(profile);
  }

  // サマリー
  console.log(`\n\n=== サマリー（最大深度 depth ${opts.maxDepth}） ===`);
  const last = profiles[profiles.length - 1];
  if (last) {
    const entries = Object.entries(last.timings) as [string, TimingEntry][];
    entries.sort((a, b) => b[1].totalMs - a[1].totalMs);
    console.log("\nボトルネック（時間降順）:");
    for (const [name, entry] of entries) {
      if (entry.calls > 0) {
        const pct = ((entry.totalMs / last.totalMs) * 100).toFixed(1);
        console.log(
          `  ${pct}%  ${name} (${entry.calls} calls, ${entry.totalMs.toFixed(1)} ms)`,
        );
      }
    }
  }
}

main();
