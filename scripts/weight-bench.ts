#!/usr/bin/env node
/**
 * eval 形系重み A/B ベンチマーク（リビルド不要・単一ビルド）
 *
 * ローカルの cpu-engine.wasm を両サイドで使い、side B にだけ --weights を
 * setEvalParam で実行時注入して対局。重みごとの worktree リビルドが要らないため
 * commit-bench より桁違いに速く重みを振れる。
 *
 *   pnpm weight:bench --weights=OPEN_THREE:600 --sets=4 --jobs=4 --randomFactor=0.02
 *   pnpm weight:bench --sets=1                    # null test (A=B baseline)
 *
 * Elo/WDL は **A=baseline 視点**（正＝baseline が強い＝変種が弱い）。
 * 前提: scripts/lib/evalParams.ts の setEvalParam を export した wasm
 *       （feat/eval-weight-injection 以降）。古い wasm では重みが無視される。
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type { CpuDifficulty } from "../src/types/cpu.ts";
import type { SPRTConfig, WeightBenchResult } from "./types/ab.ts";

import {
  computeBenchGameStats,
  formatBenchGameStats,
} from "./lib/benchGameStats.ts";
import { formatEloDiff } from "./lib/eloDiff.ts";
import { parseWeightOverrides } from "./lib/evalParams.ts";
import { createBridgeWorker, runMatch } from "./lib/match.ts";
import { resolveOpenings } from "./lib/openingSuiteLoader.ts";
import { formatPairedStats } from "./lib/pairedStats.ts";
import { DEFAULT_SPRT_CONFIG, formatSPRT } from "./lib/sprt.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "bench-results");
const WASM_PATH = path.join(
  PROJECT_ROOT,
  "zig",
  "zig-out",
  "bin",
  "cpu-engine.wasm",
);
const ZIG_SRC_DIR = path.join(PROJECT_ROOT, "zig", "src");

interface CliOptions {
  weights: Record<string, number>;
  weightsRaw: string;
  sets: number;
  difficulty: CpuDifficulty;
  randomFactor?: number;
  jobs: number;
  moveTimeoutMs: number;
  useSPRT: boolean;
  sprtElo0: number;
  sprtElo1: number;
  verbose: boolean;
  /** 開局スイート JSON（未指定なら 26 珠型）。指定時 --sets は周回数 */
  openings?: string;
  /** スイートの n 番目から使う（末尾で折り返さない）。既定 0 */
  openingOffset: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    weights: {},
    weightsRaw: "",
    sets: 1,
    difficulty: "hard",
    jobs: 1,
    moveTimeoutMs: 120000,
    useSPRT: false,
    sprtElo0: DEFAULT_SPRT_CONFIG.elo0,
    sprtElo1: DEFAULT_SPRT_CONFIG.elo1,
    verbose: false,
    openingOffset: 0,
  };

  for (const arg of args) {
    if (arg.startsWith("--weights=")) {
      options.weightsRaw = arg.slice("--weights=".length);
      options.weights = parseWeightOverrides(options.weightsRaw);
    } else if (arg.startsWith("--sets=")) {
      const v = parseInt(arg.slice("--sets=".length), 10);
      if (!isNaN(v) && v > 0) {
        options.sets = v;
      }
    } else if (arg.startsWith("--difficulty=")) {
      const v = arg.slice("--difficulty=".length);
      if (["beginner", "easy", "medium", "hard"].includes(v)) {
        options.difficulty = v as CpuDifficulty;
      }
    } else if (arg.startsWith("--randomFactor=")) {
      const v = parseFloat(arg.slice("--randomFactor=".length));
      if (!isNaN(v) && v >= 0 && v <= 1) {
        options.randomFactor = v;
      } else {
        console.error(`Error: --randomFactor は 0〜1 で指定 (got: ${v})`);
        process.exit(1);
      }
    } else if (arg.startsWith("--jobs=")) {
      const v = parseInt(arg.slice("--jobs=".length), 10);
      if (!isNaN(v) && v > 0) {
        options.jobs = v;
      }
    } else if (arg.startsWith("--moveTimeoutMs=")) {
      const v = parseInt(arg.slice("--moveTimeoutMs=".length), 10);
      if (!isNaN(v) && v > 0) {
        options.moveTimeoutMs = v;
      }
    } else if (arg === "--sprt") {
      options.useSPRT = true;
    } else if (arg.startsWith("--elo0=")) {
      options.sprtElo0 = parseFloat(arg.slice("--elo0=".length));
      options.useSPRT = true;
    } else if (arg.startsWith("--elo1=")) {
      options.sprtElo1 = parseFloat(arg.slice("--elo1=".length));
      options.useSPRT = true;
    } else if (arg.startsWith("--openings=")) {
      const value = arg.slice("--openings=".length);
      if (value.length === 0) {
        console.error("Error: --openings にはファイルパスを指定してください");
        process.exit(1);
      }
      options.openings = value;
    } else if (arg.startsWith("--opening-offset=")) {
      const raw = arg.slice("--opening-offset=".length);
      const v = parseInt(raw, 10);
      if (Number.isFinite(v) && v >= 0) {
        options.openingOffset = v;
      } else {
        console.error(
          `Error: --opening-offset は 0 以上の整数で指定 (got: ${raw})`,
        );
        process.exit(1);
      }
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Error: 不明な引数: ${arg}`);
      process.exit(1);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`
eval 形系重み A/B ベンチマーク（リビルド不要）

Usage:
  pnpm weight:bench [options]

Options:
  --weights=<K:V,...>   side B に注入する重み (例: "OPEN_THREE:600,OPEN_TWO:25")
  --sets=<n>            セット数 (1セット = 全珠型 × 2色, default: 1)。
                        --openings 指定時はスイートの周回数
  --openings=<file>     開局スイート JSON（相対パスはリポジトリルート基準）。
                        指定時は珠型の代わりにスイートの各開局 × 2 色で対局
  --opening-offset=<n>  スイートの n 番目の開局から使う（末尾で折り返さない, default: 0）
  --difficulty=<d>      beginner|easy|medium|hard (default: hard)
  --randomFactor=<n>    探索ゆらぎ 0〜1 (default: なし)
  --jobs=<n>            同時対局ペア数 (default: 1)
  --moveTimeoutMs=<n>   1手のタイムアウト (default: 120000)
  --sprt / --elo0 / --elo1
  --verbose, -v
  --help, -h

Examples:
  pnpm weight:bench --weights=OPEN_THREE:600 --sets=4 --jobs=4 --randomFactor=0.02
  pnpm weight:bench --sets=1            # null test (A=B baseline, Elo≈0)
`);
}

/**
 * wasm が最新ソースより古ければビルドし直す（古い wasm で測る事故を防ぐ）。
 * ビルド時刻・サイズをログに出す。
 */
function ensureFreshWasm(): void {
  const srcMtime = fs
    .readdirSync(ZIG_SRC_DIR)
    .filter((f) => f.endsWith(".zig"))
    .reduce((mx, f) => {
      const m = fs.statSync(path.join(ZIG_SRC_DIR, f)).mtimeMs;
      return Math.max(mx, m);
    }, 0);

  const needBuild =
    !fs.existsSync(WASM_PATH) || fs.statSync(WASM_PATH).mtimeMs < srcMtime;

  if (needBuild) {
    console.log(
      "wasm がソースより古い/不在 → ビルドします (pnpm build:wasm)...",
    );
    execSync("pnpm build:wasm", { cwd: PROJECT_ROOT, stdio: "inherit" });
  }
  const st = fs.statSync(WASM_PATH);
  console.log(
    `wasm: ${WASM_PATH} (${(st.size / 1024 / 1024).toFixed(1)}MB, built ${st.mtime.toISOString()})`,
  );
}

function resolveOpeningsOrExit(
  options: CliOptions,
): ReturnType<typeof resolveOpenings> {
  try {
    return resolveOpenings({
      openings: options.openings,
      openingOffset: options.openingOffset,
      sets: options.sets,
      randomFactor: options.randomFactor,
      rootDir: PROJECT_ROOT,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const options = parseArgs();
  const startTime = performance.now();

  ensureFreshWasm();

  const sprtConfig: SPRTConfig | null = options.useSPRT
    ? {
        elo0: options.sprtElo0,
        elo1: options.sprtElo1,
        alpha: DEFAULT_SPRT_CONFIG.alpha,
        beta: DEFAULT_SPRT_CONFIG.beta,
      }
    : null;

  // 開局の供給元とタスク列（totalGames は tasks.length が唯一の源）
  const resolved = resolveOpeningsOrExit(options);
  const { suite, tasks, totalGames, gamesPerSet } = resolved;
  const isNullTest = Object.keys(options.weights).length === 0;

  console.log(`\n=== eval 形系重み A/B ベンチマーク ===`);
  console.log(`baseline(A): 既定重み`);
  console.log(
    `variant(B): ${isNullTest ? "既定重み — null test" : JSON.stringify(options.weights)}`,
  );
  console.log(
    `難易度: ${options.difficulty}${options.randomFactor === undefined ? "" : ` (randomFactor=${options.randomFactor})`}`,
  );
  for (const line of resolved.summaryLines) {
    console.log(line);
  }
  console.log(`jobs=${options.jobs}`);
  for (const w of resolved.warnings) {
    console.warn(`⚠ ${w}`);
  }
  console.log();

  const workerPath = path.join(__dirname, "cpu-bridge-worker.ts");
  const loaderPath = path.join(__dirname, "register-loader.mjs");
  const makeWorker = (evalWeights: Record<string, number>): Promise<Worker> =>
    createBridgeWorker({
      workerPath,
      loaderPath,
      worktreePath: PROJECT_ROOT,
      difficulty: options.difficulty,
      randomFactor: options.randomFactor,
      evalWeights,
    });
  // A=baseline(空), B=variant(weights)
  const makePair = async (): Promise<{ a: Worker; b: Worker }> => {
    const [a, b] = await Promise.all([
      makeWorker({}),
      makeWorker(options.weights),
    ]);
    return { a, b };
  };

  const pairs: { a: Worker; b: Worker }[] = [];
  const cleanup = (): void => {
    for (const p of pairs) {
      p.a.terminate();
      p.b.terminate();
    }
    pairs.length = 0;
  };
  process.on("SIGINT", () => {
    console.log("\n中断。クリーンアップ中...");
    cleanup();
    process.exit(130);
  });

  try {
    console.log(`Bridge worker を初期化中... (${options.jobs}並列)`);
    const created = await Promise.all(
      Array.from({ length: options.jobs }, () => makePair()),
    );
    pairs.push(...created);
    console.log("初期化完了\n");

    const { wdl, games, completedGames, stats } = await runMatch({
      pairs,
      tasks,
      totalGames,
      sprtConfig,
      moveTimeoutMs: options.moveTimeoutMs,
      verbose: options.verbose,
      startTime,
      // 1局隔離: ハングした局は破棄しペアを再生成して続行
      recreatePair: async (idx) => {
        const fresh = await makePair();
        pairs[idx] = fresh;
        return fresh;
      },
    });

    const elapsedSeconds = (performance.now() - startTime) / 1000;

    console.log(`\n=== 結果 ===`);
    console.log(
      `variant(B): ${isNullTest ? "null test" : JSON.stringify(options.weights)}`,
    );
    if (suite) {
      console.log(
        `開局スイート: ${suite.file} (version ${suite.version}, offset=${options.openingOffset})`,
      );
    }
    console.log(`対局数: ${completedGames}`);
    console.log(
      `WDL (baseline=A 視点): +${wdl.wins} =${wdl.draws} -${wdl.losses}`,
    );
    // 三項（旧・1 局単位）とペア（新・pentanomial）を並記。停止判定はペア。
    console.log(`[三項] ${formatEloDiff(stats.trinomialElo)}`);
    console.log("(正Elo=baseline強い=変種が弱い / 負Elo=変種が強い)");
    if (stats.sprtTrinomial) {
      console.log(formatSPRT(stats.sprtTrinomial, wdl));
    }
    console.log(`[ペア] ${formatPairedStats(stats.paired)}`);
    console.log(formatBenchGameStats(computeBenchGameStats(games)));
    console.log(`所要時間: ${elapsedSeconds.toFixed(1)}秒`);

    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    const result: WeightBenchResult = {
      type: "weight-bench",
      timestamp: new Date().toISOString(),
      weights: options.weights,
      config: {
        difficulty: options.difficulty,
        sets: options.sets,
        gamesPerSet,
        randomFactor: options.randomFactor,
        sprt: sprtConfig,
        openings: resolved.config,
      },
      totalGames: completedGames,
      wdl,
      /** 三項（1 局単位）。参考値 */
      eloDiff: stats.trinomialElo,
      /** 停止に使った判定＝ペア LLR */
      sprt: stats.paired.sprt,
      sprtTrinomial: stats.sprtTrinomial,
      paired: stats.paired,
      /** 再集計（bench-reanalyze）用に棋譜を保存 */
      games,
      elapsedSeconds,
    };
    const ts = result.timestamp.replace(/[:.]/g, "-");
    const outPath = path.join(OUTPUT_DIR, `weight-bench-${ts}.json`);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`\n結果を保存: ${outPath}`);
  } finally {
    cleanup();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
