#!/usr/bin/env node
/**
 * A/B ベンチマーク比較 CLI
 *
 * パラメータ変更の効果を統計的に検証する。
 * baseline vs candidate のElo差とSPRT判定を提供。
 *
 * 使用例:
 *   pnpm ab:bench --candidate="depth:5,timeLimit:10000"
 *   pnpm ab:bench --candidate-file=params/candidate.json
 *   pnpm ab:bench --games=200 --parallel
 *   pnpm ab:bench --sprt --elo0=0 --elo1=30
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
import type { DifficultyParams } from "../src/types/cpu.ts";
import type {
  ABBenchResult,
  ABPlayerConfig,
  SPRTConfig,
  WDLCount,
} from "./types/ab.ts";

import { estimateEloDiff, formatEloDiff } from "./lib/eloDiff.ts";
import { DEFAULT_SPRT_CONFIG, formatSPRT, updateSPRT } from "./lib/sprt.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "ab-results");

interface CliOptions {
  candidateParams: Partial<DifficultyParams> | null;
  candidateFile: string | null;
  games: number;
  parallel: boolean;
  workers: number;
  useSPRT: boolean;
  sprtElo0: number;
  sprtElo1: number;
  sprtAlpha: number;
  sprtBeta: number;
  verbose: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const cpuCount = os.cpus().length;

  const options: CliOptions = {
    candidateParams: null,
    candidateFile: null,
    games: 100,
    parallel: false,
    workers: Math.max(1, cpuCount - 1),
    useSPRT: false,
    sprtElo0: DEFAULT_SPRT_CONFIG.elo0,
    sprtElo1: DEFAULT_SPRT_CONFIG.elo1,
    sprtAlpha: DEFAULT_SPRT_CONFIG.alpha,
    sprtBeta: DEFAULT_SPRT_CONFIG.beta,
    verbose: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--candidate=")) {
      options.candidateParams = parseInlineParams(
        arg.slice("--candidate=".length),
      );
    } else if (arg.startsWith("--candidate-file=")) {
      options.candidateFile = arg.slice("--candidate-file=".length);
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
    } else if (arg === "--sprt") {
      options.useSPRT = true;
    } else if (arg.startsWith("--elo0=")) {
      const value = parseFloat(arg.slice("--elo0=".length));
      if (!isNaN(value)) {
        options.sprtElo0 = value;
        options.useSPRT = true;
      }
    } else if (arg.startsWith("--elo1=")) {
      const value = parseFloat(arg.slice("--elo1=".length));
      if (!isNaN(value)) {
        options.sprtElo1 = value;
        options.useSPRT = true;
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

/**
 * インラインパラメータ文字列をパース
 * 例: "depth:5,timeLimit:10000"
 */
function parseInlineParams(str: string): Partial<DifficultyParams> {
  const params: Record<string, unknown> = {};
  for (const pair of str.split(",")) {
    const [key, value] = pair.split(":");
    if (!key || value === undefined) {
      continue;
    }
    const trimKey = key.trim();
    const trimValue = value.trim();

    // 数値に変換を試みる
    const num = Number(trimValue);
    params[trimKey] = isNaN(num) ? trimValue : num;
  }
  return params as Partial<DifficultyParams>;
}

function printHelp(): void {
  console.log(`
A/B ベンチマーク比較 CLI

Usage:
  pnpm ab:bench [options]

Options:
  --candidate=<params>       インラインパラメータ (例: "depth:5,timeLimit:10000")
  --candidate-file=<path>    パラメータJSONファイル
  --games=<n>                対局数 (default: 100, 各サイド半分ずつ)
  --parallel, -p             並列実行
  --workers=<n>              並列ワーカー数 (implies --parallel)
  --sprt                     SPRT判定を有効化
  --elo0=<n>                 H0のElo差 (default: 0)
  --elo1=<n>                 H1のElo差 (default: 30)
  --verbose, -v              詳細ログ
  --help, -h                 ヘルプを表示

Examples:
  pnpm ab:bench --candidate="depth:5,timeLimit:10000" --games=200 --parallel
  pnpm ab:bench --candidate-file=params/candidate.json --sprt
  pnpm ab:bench --games=100   # null test (baseline vs baseline)
`);
}

/**
 * ステータス行を更新
 */
function writeStatus(message: string): void {
  process.stdout.write(`\r${message.padEnd(100)}`);
}

/**
 * ステータス行をクリア
 */
function clearStatus(): void {
  process.stdout.write(`\r${" ".repeat(100)}\r`);
}

/**
 * candidate パラメータを解決
 */
function resolveCandidateParams(
  options: CliOptions,
): Partial<DifficultyParams> | undefined {
  if (options.candidateFile) {
    const filePath = path.resolve(options.candidateFile);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: ファイルが見つかりません: ${filePath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  }

  if (options.candidateParams) {
    return options.candidateParams;
  }

  // パラメータなし = null test（baseline vs baseline）
  return undefined;
}

interface GameTask {
  taskId: number;
  playerA: PlayerConfig;
  playerB: PlayerConfig;
  candidateIsBlack: boolean;
}

/**
 * 並列実行
 */
function runTasksWithWorkers(
  tasks: GameTask[],
  numWorkers: number,
  verbose: boolean,
  totalGames: number,
  sprtConfig: SPRTConfig | null,
): Promise<{ taskId: number; result: GameResult }[]> {
  const results: { taskId: number; result: GameResult }[] = [];
  const taskQueue = [...tasks];
  let completedGames = 0;
  const startTime = performance.now();
  const wdl: WDLCount = { wins: 0, draws: 0, losses: 0 };

  const workerScript = path.join(__dirname, "game-worker.ts");

  return new Promise((resolve, reject) => {
    let activeWorkers = 0;
    let finished = false;

    const startWorker = (): void => {
      if (finished) {
        return;
      }

      const task = taskQueue.shift();
      if (!task) {
        if (activeWorkers === 0) {
          finished = true;
          clearStatus();
          resolve(results);
        }
        return;
      }

      activeWorkers++;

      const worker = new Worker(workerScript, {
        workerData: {
          taskId: task.taskId,
          playerA: task.playerA,
          playerB: task.playerB,
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
        results.push(msg);
        completedGames++;

        // WDL更新（candidateから見た勝敗）
        const t = tasks[msg.taskId];
        if (t) {
          const candidateIsA = t.candidateIsBlack
            ? t.playerA.id === "candidate"
            : t.playerA.id === "candidate";
          if (msg.result.winner === "draw") {
            wdl.draws++;
          } else if (
            (msg.result.winner === "A" && candidateIsA) ||
            (msg.result.winner === "B" && !candidateIsA)
          ) {
            wdl.wins++;
          } else {
            wdl.losses++;
          }
        }

        const elapsed = ((performance.now() - startTime) / 1000).toFixed(0);
        const elo = estimateEloDiff(wdl);
        let statusMsg = `[${elapsed}s] ${completedGames}/${totalGames} +${wdl.wins}=${wdl.draws}-${wdl.losses} Elo:${elo.eloDiff > 0 ? "+" : ""}${elo.eloDiff}`;

        if (sprtConfig) {
          const sprt = updateSPRT(wdl, sprtConfig);
          statusMsg += ` LLR:${sprt.llr.toFixed(2)}`;
          if (sprt.decision !== "continue") {
            statusMsg += ` → ${sprt.decision}`;
            // SPRTが判定されたら残りのタスクをキャンセル
            taskQueue.length = 0;
          }
        }
        writeStatus(statusMsg);

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

    const initialWorkers = Math.min(numWorkers, tasks.length);
    for (let i = 0; i < initialWorkers; i++) {
      startWorker();
    }
  });
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const startTime = performance.now();

  const candidateCustomParams = resolveCandidateParams(options);

  const baseline: ABPlayerConfig = {
    id: "baseline",
    difficulty: "hard",
  };

  const candidate: ABPlayerConfig = {
    id: "candidate",
    difficulty: "hard",
    customParams: candidateCustomParams,
  };

  const isNullTest = !candidateCustomParams;

  console.log(`\n=== A/B ベンチマーク比較 ===`);
  console.log(`Baseline: hard (default)`);
  if (isNullTest) {
    console.log(`Candidate: hard (default) — null test`);
  } else {
    console.log(`Candidate: hard + ${JSON.stringify(candidateCustomParams)}`);
  }
  console.log(`対局数: ${options.games}`);

  const sprtConfig: SPRTConfig | null = options.useSPRT
    ? {
        elo0: options.sprtElo0,
        elo1: options.sprtElo1,
        alpha: options.sprtAlpha,
        beta: options.sprtBeta,
      }
    : null;

  if (sprtConfig) {
    console.log(
      `SPRT: elo0=${sprtConfig.elo0}, elo1=${sprtConfig.elo1}, alpha=${sprtConfig.alpha}, beta=${sprtConfig.beta}`,
    );
  }
  console.log();

  // タスク生成（先後交互）
  const tasks: GameTask[] = [];
  for (let i = 0; i < options.games; i++) {
    const candidateIsBlack = i % 2 === 0;

    const configBaseline: PlayerConfig = {
      id: "baseline",
      difficulty: "hard",
    };
    const configCandidate: PlayerConfig = {
      id: "candidate",
      difficulty: "hard",
      customParams: candidateCustomParams,
    };

    tasks.push({
      taskId: i,
      playerA: candidateIsBlack ? configCandidate : configBaseline,
      playerB: candidateIsBlack ? configBaseline : configCandidate,
      candidateIsBlack,
    });
  }

  // 対局実行
  const wdl: WDLCount = { wins: 0, draws: 0, losses: 0 };

  if (options.parallel) {
    // 並列実行
    const workerResults = await runTasksWithWorkers(
      tasks,
      options.workers,
      options.verbose,
      options.games,
      sprtConfig,
    );

    // 結果集計
    workerResults.sort((a, b) => a.taskId - b.taskId);
    for (const wr of workerResults) {
      const task = tasks[wr.taskId];
      if (!task) {
        continue;
      }

      if (wr.result.winner === "draw") {
        wdl.draws++;
      } else {
        // candidateが黒番の場合: A勝ち=candidate勝ち
        // candidateが白番の場合: B勝ち=candidate勝ち
        const candidateIsA = task.playerA.id === "candidate";
        const candidateWon =
          (wr.result.winner === "A" && candidateIsA) ||
          (wr.result.winner === "B" && !candidateIsA);
        if (candidateWon) {
          wdl.wins++;
        } else {
          wdl.losses++;
        }
      }
    }
  } else {
    // 逐次実行
    const { runHeadlessGame } =
      await import("../src/logic/cpu/benchmark/headless.ts");
    const seqStartTime = performance.now();

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (!task) {
        continue;
      }

      const elapsed = ((performance.now() - seqStartTime) / 1000).toFixed(0);
      writeStatus(`[${elapsed}s] Game ${i + 1}/${options.games}`);

      const result = runHeadlessGame(task.playerA, task.playerB, {
        verbose: options.verbose,
      });

      if (result.winner === "draw") {
        wdl.draws++;
      } else {
        const candidateIsA = task.playerA.id === "candidate";
        const candidateWon =
          (result.winner === "A" && candidateIsA) ||
          (result.winner === "B" && !candidateIsA);
        if (candidateWon) {
          wdl.wins++;
        } else {
          wdl.losses++;
        }
      }

      // SPRT早期停止チェック
      if (sprtConfig) {
        const sprtState = updateSPRT(wdl, sprtConfig);
        if (sprtState.decision !== "continue") {
          clearStatus();
          console.log(`SPRT判定: ${sprtState.decision} (${i + 1}局目で停止)`);
          break;
        }
      }
    }
    clearStatus();
  }

  const elapsedSeconds = (performance.now() - startTime) / 1000;

  // 結果表示
  console.log(`\n=== 結果 ===`);
  const totalPlayed = wdl.wins + wdl.draws + wdl.losses;
  console.log(`対局数: ${totalPlayed}`);
  console.log(`WDL (candidate視点): +${wdl.wins} =${wdl.draws} -${wdl.losses}`);

  const eloDiffResult = estimateEloDiff(wdl);
  console.log(formatEloDiff(eloDiffResult));

  let sprtState = null;
  if (sprtConfig) {
    sprtState = updateSPRT(wdl, sprtConfig);
    console.log(formatSPRT(sprtState, wdl));
  }

  console.log(`所要時間: ${elapsedSeconds.toFixed(1)}秒`);

  // 結果保存
  const result: ABBenchResult = {
    timestamp: new Date().toISOString(),
    config: {
      baseline,
      candidate,
      gamesPerSide: Math.floor(options.games / 2),
      sprt: sprtConfig,
    },
    totalGames: totalPlayed,
    wdl,
    eloDiff: eloDiffResult,
    sprt: sprtState,
    elapsedSeconds,
  };

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const timestamp = result.timestamp.replace(/[:.]/g, "-");
  const outputPath = path.join(OUTPUT_DIR, `ab-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\n結果を保存: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
