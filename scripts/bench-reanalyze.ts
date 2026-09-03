/**
 * ベンチ結果 JSON の再集計 CLI
 *
 * commit-bench / weight-bench の結果 JSON（games 付き）を読み、
 *   - 三項（1 局単位）vs ペア（pentanomial）の Elo / CI
 *   - pentanomial の内訳
 *   - distinct 棋譜数（先頭 8/12/16 手・完全一致）
 *   - 色別勝率・開局ラベル別の勝敗
 * を表示する。docs/plans/bench-precision-2026-09-04.md §1 の分析を恒久化したもの。
 *
 * 旧 JSON（pairId 無し）は jushuName でペアリングする（toPairableGames の規則。
 * 並列実行では出現順がタスク順でないので unpaired が出うる）。
 *
 * Usage:
 *   pnpm bench:reanalyze [file...]
 *     file 省略時は bench-results/ の commit-bench-*.json のうち最新 1 本。
 *   --openings   開局ラベル別の表も出す
 *   --elo0/--elo1  ペア LLR を表示するときの SPRT 仮説（既定 0 / 30）
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { SPRTConfig, WDLCount } from "./types/ab.ts";
import type { CommitGameResult } from "./types/commit-bench.ts";

import {
  computeBenchGameStats,
  formatBenchGameStats,
} from "./lib/benchGameStats.ts";
import { estimateEloDiff, formatEloDiff } from "./lib/eloDiff.ts";
import {
  computePairedStats,
  formatPairedStats,
  toPairableGames,
} from "./lib/pairedStats.ts";
import { DEFAULT_SPRT_CONFIG, formatSPRT, updateSPRT } from "./lib/sprt.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "..", "bench-results");

interface Options {
  files: string[];
  showOpenings: boolean;
  sprt: SPRTConfig;
}

function parseArgs(): Options {
  const options: Options = {
    files: [],
    showOpenings: false,
    sprt: { ...DEFAULT_SPRT_CONFIG },
  };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--openings") {
      options.showOpenings = true;
    } else if (arg.startsWith("--elo0=")) {
      options.sprt.elo0 = parseFloat(arg.slice("--elo0=".length));
    } else if (arg.startsWith("--elo1=")) {
      options.sprt.elo1 = parseFloat(arg.slice("--elo1=".length));
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: pnpm bench:reanalyze [file...] [--openings] [--elo0=N] [--elo1=N]",
          "  file 省略時は bench-results/commit-bench-*.json の最新 1 本",
        ].join("\n"),
      );
      process.exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.files.push(arg);
    }
  }
  return options;
}

/** bench-results/ の commit-bench-*.json のうち名前順で最後（= 最新）。 */
function findLatestCommitBench(): string {
  const names = fs
    .readdirSync(RESULTS_DIR)
    .filter((n) => n.startsWith("commit-bench-") && n.endsWith(".json"))
    .sort();
  const last = names.at(-1);
  if (!last) {
    throw new Error(`commit-bench-*.json が見つかりません: ${RESULTS_DIR}`);
  }
  return path.join(RESULTS_DIR, last);
}

/** 再集計に必要な最小限の JSON 形（commit-bench / weight-bench 共通部分）。 */
interface BenchJson {
  type?: string;
  timestamp?: string;
  commitA?: { shortSha: string; message?: string };
  commitB?: { shortSha: string; message?: string };
  config?: { difficulty?: string; sets?: number; randomFactor?: number };
  totalGames?: number;
  wdl?: WDLCount;
  games?: CommitGameResult[];
}

function wdlFromGames(games: CommitGameResult[]): WDLCount {
  const wdl: WDLCount = { wins: 0, draws: 0, losses: 0 };
  for (const g of games) {
    if (g.winner === "A") {
      wdl.wins++;
    } else if (g.winner === "B") {
      wdl.losses++;
    } else {
      wdl.draws++;
    }
  }
  return wdl;
}

function analyzeFile(file: string, options: Options): void {
  const json = JSON.parse(fs.readFileSync(file, "utf8")) as BenchJson;
  const { games } = json;
  if (!Array.isArray(games) || games.length === 0) {
    console.log(
      `\n=== ${path.basename(file)} ===\n  games が無いので再集計できません`,
    );
    return;
  }

  console.log(`\n=== ${path.basename(file)} ===`);
  const head: string[] = [];
  if (json.type) {
    head.push(json.type);
  }
  if (json.commitA && json.commitB) {
    head.push(`A=${json.commitA.shortSha} B=${json.commitB.shortSha}`);
  }
  if (json.config) {
    const c = json.config;
    head.push(
      `difficulty=${c.difficulty ?? "?"} sets=${c.sets ?? "?"}${c.randomFactor === undefined ? "" : ` r=${c.randomFactor}`}`,
    );
  }
  console.log(`  ${head.join(" | ")}`);
  const hasPairId = games.some((g) => g.pairId !== undefined);
  console.log(
    `  局数: ${games.length}  ペアリング: ${hasPairId ? "pairId" : "jushuName（旧 JSON 規則）"}`,
  );

  // 三項（旧）
  const wdl = json.wdl ?? wdlFromGames(games);
  console.log(`\n[三項] WDL(A視点): +${wdl.wins} =${wdl.draws} -${wdl.losses}`);
  console.log(`  ${formatEloDiff(estimateEloDiff(wdl))}`);
  console.log(
    `  ${formatSPRT(updateSPRT(wdl, options.sprt), wdl).split("\n")[0]}`,
  );

  // ペア（新）
  const paired = computePairedStats(toPairableGames(games), options.sprt);
  console.log(`\n[ペア] ${formatPairedStats(paired)}`);

  // 棋譜の重複・色別
  const gameStats = computeBenchGameStats(games);
  console.log(`\n[棋譜] ${formatBenchGameStats(gameStats)}`);

  if (options.showOpenings) {
    console.log(`\n[開局別] (A視点 WDL / 黒勝-白勝-分)`);
    for (const o of gameStats.openings) {
      const bw = o.games > 0 ? ((o.blackWins / o.games) * 100).toFixed(0) : "-";
      console.log(
        `  ${o.openingId.padEnd(8)} ${String(o.games).padStart(4)}局  +${o.wdl.wins} =${o.wdl.draws} -${o.wdl.losses}  黒${o.blackWins}-白${o.whiteWins}-分${o.draws} (黒${bw}%)`,
      );
    }
  }
}

function main(): void {
  const options = parseArgs();
  const files =
    options.files.length > 0 ? options.files : [findLatestCommitBench()];
  for (const f of files) {
    analyzeFile(f, options);
  }
}

main();
