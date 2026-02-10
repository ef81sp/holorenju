#!/usr/bin/env node
/**
 * 弱点パターン分析 CLI
 *
 * 使用例:
 *   pnpm analyze:weakness                          # 最新ベンチ結果を分析
 *   pnpm analyze:weakness --file=<bench.json>      # 指定ファイル
 *   pnpm analyze:weakness --run --games=20         # 対局してから分析
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type {
  GameResult,
  PlayerConfig,
} from "../src/logic/cpu/benchmark/headless.ts";
import type { BenchmarkResultFile } from "./types/analysis.ts";

import {
  analyzeWeaknesses,
  formatWeaknessReport,
} from "./lib/weaknessAnalyzer.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const BENCH_DIR = path.join(PROJECT_ROOT, "bench-results");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "weakness-reports");

interface CliOptions {
  file: string | null;
  run: boolean;
  games: number;
  parallel: boolean;
  workers: number;
  verbose: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const cpuCount = os.cpus().length;

  const options: CliOptions = {
    file: null,
    run: false,
    games: 20,
    parallel: false,
    workers: Math.max(1, cpuCount - 1),
    verbose: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--file=")) {
      options.file = arg.slice("--file=".length);
    } else if (arg === "--run") {
      options.run = true;
    } else if (arg.startsWith("--games=")) {
      const value = parseInt(arg.slice("--games=".length), 10);
      if (!isNaN(value) && value > 0) {
        options.games = value;
      }
    } else if (arg === "--parallel" || arg === "-p") {
      options.parallel = true;
    } else if (arg.startsWith("--workers=")) {
      const value = parseInt(arg.slice("--workers=".length), 10);
      if (!isNaN(value) && value > 0) {
        options.workers = value;
        options.parallel = true;
      }
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
弱点パターン分析 CLI

Usage:
  pnpm analyze:weakness [options]

Options:
  --file=<path>      分析対象のベンチマーク結果ファイル
  --run              hard同士の対局を実行してから分析
  --games=<n>        --run時の対局数 (default: 20)
  --parallel, -p     --run時に並列実行
  --workers=<n>      並列ワーカー数 (implies --parallel)
  --verbose, -v      詳細ログ
  --help, -h         ヘルプを表示

Examples:
  pnpm analyze:weakness
  pnpm analyze:weakness --file=bench-results/bench-*.json
  pnpm analyze:weakness --run --games=20 --parallel
`);
}

/**
 * 最新のベンチマーク結果ファイルを取得
 */
function findLatestBenchFile(): string {
  if (!fs.existsSync(BENCH_DIR)) {
    console.error(`Error: bench-results/ ディレクトリが見つかりません`);
    console.error(
      `  pnpm bench で対局を実行するか --run オプションを使用してください`,
    );
    process.exit(1);
  }

  const files = fs
    .readdirSync(BENCH_DIR)
    .filter((f) => f.startsWith("bench-") && f.endsWith(".json"))
    .map((f) => ({
      name: f,
      path: path.join(BENCH_DIR, f),
      mtime: fs.statSync(path.join(BENCH_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    console.error(`Error: bench-results/ にベンチマーク結果がありません`);
    process.exit(1);
  }

  return files[0].path;
}

/**
 * ステータス行を更新
 */
function writeStatus(message: string): void {
  process.stdout.write(`\r${message.padEnd(80)}`);
}

/**
 * ステータス行をクリア
 */
function clearStatus(): void {
  process.stdout.write(`\r${" ".repeat(80)}\r`);
}

/**
 * hard同士の自己対戦を実行
 */
async function runSelfPlay(options: CliOptions): Promise<BenchmarkResultFile> {
  const { games, verbose } = options;

  console.log(`\n=== hard同士の自己対戦 (${games}局) ===\n`);

  const results: GameResult[] = [];

  if (options.parallel) {
    // 並列実行
    const workerScript = path.join(__dirname, "game-worker.ts");
    const tasks: { taskId: number; isABlack: boolean }[] = [];

    for (let i = 0; i < games; i++) {
      tasks.push({ taskId: i, isABlack: i % 2 === 0 });
    }

    const workerResults = await new Promise<
      { taskId: number; result: GameResult }[]
    >((resolve, reject) => {
      const workerResults: { taskId: number; result: GameResult }[] = [];
      const taskQueue = [...tasks];
      let activeWorkers = 0;
      let completedGames = 0;
      let finished = false;
      const startTime = performance.now();

      const startWorker = (): void => {
        if (finished) {
          return;
        }

        const task = taskQueue.shift();
        if (!task) {
          if (activeWorkers === 0) {
            finished = true;
            clearStatus();
            resolve(workerResults);
          }
          return;
        }

        activeWorkers++;

        const configA: PlayerConfig = { id: "hard", difficulty: "hard" };
        const configB: PlayerConfig = { id: "hard", difficulty: "hard" };

        const worker = new Worker(workerScript, {
          workerData: {
            taskId: task.taskId,
            playerA: task.isABlack ? configA : configB,
            playerB: task.isABlack ? configB : configA,
            verbose,
          },
          execArgv: [
            "--experimental-strip-types",
            "--disable-warning=ExperimentalWarning",
            "--import",
            path.join(__dirname, "register-loader.mjs"),
          ],
        });

        worker.on("message", (msg: { taskId: number; result: GameResult }) => {
          workerResults.push(msg);
          completedGames++;
          const elapsed = ((performance.now() - startTime) / 1000).toFixed(0);
          writeStatus(
            `[${elapsed}s] Progress: ${completedGames}/${games} (${((completedGames / games) * 100).toFixed(1)}%)`,
          );
          activeWorkers--;
          startWorker();
        });

        worker.on("error", (err) => {
          if (!finished) {
            finished = true;
            reject(err);
          }
        });

        worker.on("exit", (code) => {
          if (code !== 0 && !finished) {
            console.error(`Worker exited with code ${code}`);
          }
        });
      };

      const numWorkers = Math.min(options.workers, tasks.length);
      for (let i = 0; i < numWorkers; i++) {
        startWorker();
      }
    });

    // タスクID順にソート
    workerResults.sort((a, b) => a.taskId - b.taskId);
    for (const wr of workerResults) {
      results.push(wr.result);
    }
  } else {
    // 逐次実行
    const { runHeadlessGame } =
      await import("../src/logic/cpu/benchmark/headless.ts");
    const startTime = performance.now();

    for (let i = 0; i < games; i++) {
      const isABlack = i % 2 === 0;
      const configA: PlayerConfig = { id: "hard", difficulty: "hard" };
      const configB: PlayerConfig = { id: "hard", difficulty: "hard" };

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(0);
      writeStatus(`[${elapsed}s] Game ${i + 1}/${games} - playing...`);

      const result = runHeadlessGame(
        isABlack ? configA : configB,
        isABlack ? configB : configA,
        { verbose },
      );
      results.push(result);
    }
    clearStatus();
  }

  console.log(`\n${results.length}局の対局が完了`);

  // BenchmarkResultFile形式に変換
  return {
    timestamp: new Date().toISOString(),
    options: {
      players: ["hard"],
      gamesPerMatchup: games,
      parallel: options.parallel,
      workers: options.parallel ? options.workers : 1,
    },
    ratings: {},
    matchups: [],
    games: results.map((r) => ({
      ...r,
      isABlack: true, // hard同士なので常にtrue扱い
    })),
  };
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const options = parseArgs();

  let benchData: BenchmarkResultFile | undefined = undefined;
  let sourceFile = "";

  if (options.run) {
    // 自己対戦を実行してから分析
    benchData = await runSelfPlay(options);
    sourceFile = "(self-play)";

    // 結果も保存
    if (!fs.existsSync(BENCH_DIR)) {
      fs.mkdirSync(BENCH_DIR, { recursive: true });
    }
    const timestamp = benchData.timestamp.replace(/[:.]/g, "-");
    const benchPath = path.join(BENCH_DIR, `bench-selfplay-${timestamp}.json`);
    fs.writeFileSync(benchPath, JSON.stringify(benchData, null, 2));
    console.log(`対局結果を保存: ${benchPath}`);
  } else {
    // 既存のベンチマーク結果を読み込み
    const filePath = options.file
      ? path.resolve(options.file)
      : findLatestBenchFile();

    if (!fs.existsSync(filePath)) {
      console.error(`Error: ファイルが見つかりません: ${filePath}`);
      process.exit(1);
    }

    console.log(`分析対象: ${path.basename(filePath)}`);
    const content = fs.readFileSync(filePath, "utf-8");
    benchData = JSON.parse(content);
    sourceFile = path.basename(filePath);
  }

  // 弱点分析の実行
  console.log("\n弱点パターンを分析中...\n");
  const report = analyzeWeaknesses(benchData, sourceFile);

  // コンソール出力
  const output = formatWeaknessReport(report);
  process.stdout.write(output);

  // JSON保存
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const timestamp = report.timestamp.replace(/[:.]/g, "-");
  const outputPath = path.join(OUTPUT_DIR, `weakness-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nレポートを保存: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
