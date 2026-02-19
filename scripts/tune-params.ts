#!/usr/bin/env node
/**
 * SPSA パラメータチューニング CLI
 *
 * PATTERN_SCORES のパラメータを自動最適化する。
 * Stockfish の Fishtest と同じ原理（SPSA）を使用。
 *
 * 使用例:
 *   pnpm tune:params                                    # デフォルトパラメータセット
 *   pnpm tune:params --params-file=params/tunables.json # カスタム
 *   pnpm tune:params --iterations=100 --games=40        # SPSA設定
 *   pnpm tune:params --resume=tune-results/tune-*.json  # チェックポイントから再開
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
import type { PatternScoreValues } from "../src/logic/cpu/evaluation/patternScores.ts";

import {
  computeAk,
  computeCk,
  formatParamDiff,
  generatePerturbation,
  perturbParams,
  tunablesToRecord,
  updateParams,
} from "./lib/spsa.ts";
import {
  DEFAULT_SPSA_CONFIG,
  type IterationResult,
  type SPSAConfig,
  type TunableParamSet,
  type TuneResult,
} from "./types/tune.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "tune-results");
const DEFAULT_PARAMS_FILE = path.join(
  PROJECT_ROOT,
  "params/default-tunables.json",
);

interface CliOptions {
  paramsFile: string;
  iterations: number;
  games: number;
  parallel: boolean;
  workers: number;
  resume: string | null;
  verbose: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const cpuCount = os.cpus().length;

  const options: CliOptions = {
    paramsFile: DEFAULT_PARAMS_FILE,
    iterations: DEFAULT_SPSA_CONFIG.iterations,
    games: DEFAULT_SPSA_CONFIG.gamesPerIteration,
    parallel: false,
    workers: Math.max(1, cpuCount - 1),
    resume: null,
    verbose: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--params-file=")) {
      options.paramsFile = arg.slice("--params-file=".length);
    } else if (arg.startsWith("--iterations=")) {
      const value = parseInt(arg.slice("--iterations=".length), 10);
      if (!isNaN(value) && value > 0) {
        options.iterations = value;
      }
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
    } else if (arg.startsWith("--resume=")) {
      options.resume = arg.slice("--resume=".length);
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
SPSA パラメータチューニング CLI

Usage:
  pnpm tune:params [options]

Options:
  --params-file=<path>   チューニング対象パラメータ (default: params/default-tunables.json)
  --iterations=<n>       SPSAイテレーション数 (default: 100)
  --games=<n>            各イテレーションの対局数 (default: 40)
  --parallel, -p         並列実行
  --workers=<n>          並列ワーカー数 (implies --parallel)
  --resume=<path>        チェックポイントから再開
  --verbose, -v          詳細ログ
  --help, -h             ヘルプを表示

Examples:
  pnpm tune:params
  pnpm tune:params --iterations=50 --games=20 --parallel
  pnpm tune:params --resume=tune-results/tune-*.json
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
 * パラメータ値をPatternScoreOverridesに変換
 */
function paramsToOverrides(
  params: Record<string, number>,
): Partial<PatternScoreValues> {
  return params as Partial<PatternScoreValues>;
}

/**
 * θ+ vs θ- の対局を実行してスコアを返す
 *
 * @returns [scorePlus, scoreMinus] — θ+ と θ- のそれぞれの勝率
 */
async function runMatchup(
  thetaPlus: Record<string, number>,
  thetaMinus: Record<string, number>,
  numGames: number,
  options: CliOptions,
): Promise<[number, number]> {
  const configPlus: PlayerConfig = {
    id: "theta+",
    difficulty: "hard",
    customParams: {
      evaluationOptions: {
        enableFukumi: true,
        enableMise: true,
        enableForbiddenTrap: true,
        enableMultiThreat: true,
        enableCounterFour: true,
        enableVCT: true,
        enableMandatoryDefense: true,
        enableSingleFourPenalty: true,
        singleFourPenaltyMultiplier: 0.0,
        enableMiseThreat: true,
        enableDoubleThreeThreat: true,
        enableNullMovePruning: true,
        enableFutilityPruning: true,
        enableForbiddenVulnerability: true,
        patternScoreOverrides: paramsToOverrides(thetaPlus),
      },
    },
  };

  const configMinus: PlayerConfig = {
    id: "theta-",
    difficulty: "hard",
    customParams: {
      evaluationOptions: {
        enableFukumi: true,
        enableMise: true,
        enableForbiddenTrap: true,
        enableMultiThreat: true,
        enableCounterFour: true,
        enableVCT: true,
        enableMandatoryDefense: true,
        enableSingleFourPenalty: true,
        singleFourPenaltyMultiplier: 0.0,
        enableMiseThreat: true,
        enableDoubleThreeThreat: true,
        enableNullMovePruning: true,
        enableFutilityPruning: true,
        enableForbiddenVulnerability: true,
        patternScoreOverrides: paramsToOverrides(thetaMinus),
      },
    },
  };

  let plusWins = 0;
  let minusWins = 0;
  let draws = 0;

  if (options.parallel) {
    const results = await runGamesParallel(
      configPlus,
      configMinus,
      numGames,
      options,
    );
    for (const r of results) {
      if (r.winner === "draw") {
        draws++;
      } else if (
        (r.winner === "A" && r.playerA === "theta+") ||
        (r.winner === "B" && r.playerB === "theta+")
      ) {
        plusWins++;
      } else {
        minusWins++;
      }
    }
  } else {
    const { runHeadlessGame } =
      await import("../src/logic/cpu/benchmark/headless.ts");

    for (let i = 0; i < numGames; i++) {
      const isPlusBlack = i % 2 === 0;
      const black = isPlusBlack ? configPlus : configMinus;
      const white = isPlusBlack ? configMinus : configPlus;

      const result = runHeadlessGame(black, white, {
        verbose: options.verbose,
      });

      if (result.winner === "draw") {
        draws++;
      } else if (isPlusBlack) {
        if (result.winner === "A") {
          plusWins++;
        } else {
          minusWins++;
        }
      } else {
        if (result.winner === "A") {
          minusWins++;
        } else {
          plusWins++;
        }
      }
    }
  }

  const total = plusWins + minusWins + draws;
  const scorePlus = (plusWins + 0.5 * draws) / total;
  const scoreMinus = (minusWins + 0.5 * draws) / total;

  return [scorePlus, scoreMinus];
}

/**
 * 対局を並列実行
 */
function runGamesParallel(
  configPlus: PlayerConfig,
  configMinus: PlayerConfig,
  numGames: number,
  options: CliOptions,
): Promise<GameResult[]> {
  const workerScript = path.join(__dirname, "game-worker.ts");
  const results: GameResult[] = [];

  interface Task {
    taskId: number;
    playerA: PlayerConfig;
    playerB: PlayerConfig;
  }

  const tasks: Task[] = [];
  for (let i = 0; i < numGames; i++) {
    const isPlusBlack = i % 2 === 0;
    tasks.push({
      taskId: i,
      playerA: isPlusBlack ? configPlus : configMinus,
      playerB: isPlusBlack ? configMinus : configPlus,
    });
  }

  return new Promise((resolve, reject) => {
    const taskQueue = [...tasks];
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
          verbose: options.verbose,
        },
        execArgv: [
          "--experimental-strip-types",
          "--disable-warning=ExperimentalWarning",
          "--import",
          path.join(__dirname, "register-loader.mjs"),
        ],
      });

      worker.on("message", (msg: { taskId: number; result: GameResult }) => {
        results.push(msg.result);
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
}

/**
 * チェックポイントを保存
 */
function saveCheckpoint(result: TuneResult): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const timestamp = result.timestamp.replace(/[:.]/g, "-");
  const outputPath = path.join(OUTPUT_DIR, `tune-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const options = parseArgs();
  const startTime = performance.now();

  // パラメータ定義の読み込み
  const paramsPath = path.resolve(options.paramsFile);
  if (!fs.existsSync(paramsPath)) {
    console.error(`Error: パラメータファイルが見つかりません: ${paramsPath}`);
    process.exit(1);
  }
  const tunableSet: TunableParamSet = JSON.parse(
    fs.readFileSync(paramsPath, "utf-8"),
  );
  const tunables = tunableSet.params;

  // SPSA設定
  const spsaConfig: SPSAConfig = {
    ...DEFAULT_SPSA_CONFIG,
    iterations: options.iterations,
    gamesPerIteration: options.games,
    A: Math.floor(options.iterations * 0.1),
  };

  // 初期パラメータ
  let currentParams = tunablesToRecord(tunables);
  const initialParams = { ...currentParams };
  let startIteration = 0;
  const iterationResults: IterationResult[] = [];

  // チェックポイントからの再開
  if (options.resume) {
    const resumePath = path.resolve(options.resume);
    if (!fs.existsSync(resumePath)) {
      console.error(`Error: チェックポイントが見つかりません: ${resumePath}`);
      process.exit(1);
    }
    const checkpoint: TuneResult = JSON.parse(
      fs.readFileSync(resumePath, "utf-8"),
    );
    currentParams = { ...checkpoint.finalParams };
    startIteration = checkpoint.iterations.length;
    iterationResults.push(...checkpoint.iterations);
    console.log(`チェックポイントから再開: iteration ${startIteration} から`);
  }

  console.log(`\n=== SPSA パラメータチューニング ===`);
  console.log(`パラメータ数: ${tunables.length}`);
  console.log(`イテレーション: ${spsaConfig.iterations}`);
  console.log(`対局数/イテレーション: ${spsaConfig.gamesPerIteration}`);
  console.log(
    `推定総対局数: ${spsaConfig.iterations * spsaConfig.gamesPerIteration}`,
  );
  console.log();

  console.log("初期パラメータ:");
  for (const param of tunables) {
    console.log(
      `  ${param.name}: ${currentParams[param.name]} [${param.min}, ${param.max}]`,
    );
  }
  console.log();

  const timestamp = new Date().toISOString();
  let totalGames = 0;

  for (let k = startIteration; k < spsaConfig.iterations; k++) {
    const ak = computeAk(spsaConfig, k);
    const ck = computeCk(spsaConfig, k);

    // 摂動ベクトル生成
    const delta = generatePerturbation(tunables.length);

    // θ+ と θ- を生成
    const [thetaPlus, thetaMinus] = perturbParams(
      currentParams,
      tunables,
      delta,
      ck,
    );

    const iterStartTime = performance.now();
    writeStatus(
      `[iter ${k + 1}/${spsaConfig.iterations}] θ+ vs θ- (${spsaConfig.gamesPerIteration}局)...`,
    );

    // 対戦実行（各イテレーションは前回の結果に依存するため逐次実行）

    // oxlint-disable-next-line no-await-in-loop
    const [scorePlus, scoreMinus] = await runMatchup(
      thetaPlus,
      thetaMinus,
      spsaConfig.gamesPerIteration,
      options,
    );
    totalGames += spsaConfig.gamesPerIteration;

    // パラメータ更新
    const [updatedParams, gradient] = updateParams(
      currentParams,
      tunables,
      delta,
      scorePlus,
      scoreMinus,
      ak,
      ck,
    );
    currentParams = updatedParams;

    const iterTime = ((performance.now() - iterStartTime) / 1000).toFixed(1);

    clearStatus();
    console.log(
      `iter ${k + 1}: θ+=${(scorePlus * 100).toFixed(1)}% θ-=${(scoreMinus * 100).toFixed(1)}% (${iterTime}s)`,
    );

    if (options.verbose) {
      for (const param of tunables) {
        const g = gradient[param.name] ?? 0;
        console.log(
          `  ${param.name}: ${currentParams[param.name]} (g=${g.toFixed(4)})`,
        );
      }
    }

    // イテレーション結果を記録
    iterationResults.push({
      iteration: k + 1,
      scorePlus,
      scoreMinus,
      params: { ...currentParams },
      gradient: { ...gradient },
    });

    // 定期チェックポイント（10イテレーションごと）
    if ((k + 1) % 10 === 0) {
      const result: TuneResult = {
        timestamp,
        config: spsaConfig,
        tunableParams: tunables,
        initialParams,
        finalParams: { ...currentParams },
        iterations: iterationResults,
        elapsedSeconds: (performance.now() - startTime) / 1000,
        totalGames,
      };
      saveCheckpoint(result);
      console.log(`  [checkpoint saved at iter ${k + 1}]`);
    }
  }

  const elapsedSeconds = (performance.now() - startTime) / 1000;

  // 最終結果
  console.log(`\n=== チューニング完了 ===`);
  console.log(`所要時間: ${(elapsedSeconds / 60).toFixed(1)}分`);
  console.log(`総対局数: ${totalGames}`);
  console.log();

  console.log("パラメータ変化:");
  console.log(formatParamDiff(initialParams, currentParams));
  console.log();

  // 結果保存
  const result: TuneResult = {
    timestamp,
    config: spsaConfig,
    tunableParams: tunables,
    initialParams,
    finalParams: currentParams,
    iterations: iterationResults,
    elapsedSeconds,
    totalGames,
  };
  saveCheckpoint(result);

  const outputTimestamp = timestamp.replace(/[:.]/g, "-");
  console.log(
    `結果を保存: ${path.join(OUTPUT_DIR, `tune-${outputTimestamp}.json`)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
