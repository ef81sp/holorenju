/**
 * CPU AI ベンチマーク CLI
 *
 * 使用例:
 *   pnpm bench:ai                              # 全難易度総当たり
 *   pnpm bench:ai --players=medium,hard        # 特定難易度
 *   pnpm bench:ai --games=100 --verbose        # オプション指定
 *   pnpm bench:ai --parallel                   # 並列実行
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type { Position } from "../src/types/game.ts";

import {
  calculateStats,
  createInitialRating,
  formatRating,
  runHeadlessGame,
  updateRatings,
  type EloRating,
  type GameResult,
  type PlayerConfig,
} from "../src/logic/cpu/benchmark/index.ts";
import {
  applyPatternScoreOverrides,
  PATTERN_SCORES,
  type PatternScoreValues,
} from "../src/logic/cpu/evaluation/patternScores.ts";
import {
  getAllJushuNames,
  getJushuPositions,
} from "../src/logic/cpu/opening.ts";
import { CPU_DIFFICULTIES, type CpuDifficulty } from "../src/types/cpu.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface CliOptions {
  players: CpuDifficulty[];
  sets: number;
  output: string;
  format: "json" | "csv";
  verbose: boolean;
  parallel: boolean;
  workers: number;
  self: boolean; // 同じ難易度同士の対戦モード
  scoreOverrides: Partial<PatternScoreValues>;
}

interface MatchupResult {
  playerA: string;
  playerB: string;
  winsA: number;
  winsB: number;
  draws: number;
  total: number;
}

interface BenchmarkResult {
  timestamp: string;
  options: {
    players: string[];
    sets: number;
    gamesPerSet: number;
    parallel: boolean;
    workers: number;
  };
  ratings: Record<string, EloRating>;
  matchups: MatchupResult[];
  games: GameResult[];
}

interface GameTask {
  taskId: number;
  playerA: PlayerConfig;
  playerB: PlayerConfig;
  matchupIndex: number;
  gameIndex: number;
  isABlack: boolean;
  openingMoves?: [Position, Position, Position];
  jushuName?: string;
}

interface WorkerResult {
  taskId: number;
  result: GameResult;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const cpuCount = os.cpus().length;

  const options: CliOptions = {
    players: [...CPU_DIFFICULTIES],
    sets: 1,
    output: "bench-results",
    format: "json",
    verbose: false,
    parallel: false,
    workers: Math.min(3, Math.max(1, cpuCount - 1)),
    self: false,
    scoreOverrides: {},
  };

  for (const arg of args) {
    if (arg.startsWith("--players=")) {
      const value = arg.slice("--players=".length);
      const players = value
        .split(",")
        .filter((p): p is CpuDifficulty =>
          CPU_DIFFICULTIES.includes(p as CpuDifficulty),
        );
      if (players.length > 0) {
        options.players = players;
      }
    } else if (arg.startsWith("--sets=")) {
      const value = parseInt(arg.slice("--sets=".length), 10);
      if (!isNaN(value) && value > 0) {
        options.sets = value;
      }
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (value === "json" || value === "csv") {
        options.format = value;
      }
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--parallel" || arg === "-p") {
      options.parallel = true;
    } else if (arg.startsWith("--workers=")) {
      const value = parseInt(arg.slice("--workers=".length), 10);
      if (!isNaN(value) && value > 0) {
        options.workers = Math.min(3, value);
        options.parallel = true;
      }
    } else if (arg === "--self" || arg === "-s") {
      options.self = true;
    } else if (arg.startsWith("--score-override=")) {
      const value = arg.slice("--score-override=".length);
      for (const pair of value.split(",")) {
        const [key, val] = pair.split(":");
        if (key && val !== undefined && key in PATTERN_SCORES) {
          (options.scoreOverrides as Record<string, number>)[key] = Number(val);
        } else if (key) {
          console.warn(`Warning: unknown score key "${key}", skipping`);
        }
      }
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  const cpuCount = os.cpus().length;
  console.log(`
CPU AI Benchmark CLI

Usage:
  pnpm bench:ai [options]

Options:
  --players=<list>   Comma-separated list of difficulties to benchmark
                     (beginner,easy,medium,hard). Default: all
  --sets=<n>         Number of sets per matchup (1 set = 26 jushu × 2 colors = 52 games).
                     Default: 1 (52 games)
  --output=<dir>     Output directory. Default: bench-results
  --format=<fmt>     Output format (json|csv). Default: json
  --verbose, -v      Enable verbose logging
  --parallel, -p     Enable parallel execution using worker threads
  --workers=<n>      Number of worker threads (max 3). Default: ${Math.min(3, cpuCount - 1)}
                     (implies --parallel)
  --self, -s         Self-play only mode: each difficulty plays only against
                     itself (excludes cross-difficulty matchups)
  --score-override=<k:v,...>
                     Override PATTERN_SCORES values (comma-separated KEY:VALUE).
                     Applied before benchmark starts. Use for A/B testing.
  --help, -h         Show this help message

Examples:
  pnpm bench:ai
  pnpm bench:ai --players=medium,hard --sets=1
  pnpm bench:ai --parallel --workers=4
  pnpm bench:ai --verbose --format=csv
  pnpm bench:ai --self --players=hard --sets=2   # hard vs hard (self-play)
  pnpm bench:ai --score-override=LEAF_COMPOUND_THREAT_BONUS:0  # A/B test
`);
}

function generateMatchups(
  players: CpuDifficulty[],
  selfPlayOnly = false,
): [CpuDifficulty, CpuDifficulty][] {
  const matchups: [CpuDifficulty, CpuDifficulty][] = [];

  if (selfPlayOnly) {
    // 自己対戦のみモード: 各難易度が自分自身と対戦
    for (const player of players) {
      matchups.push([player, player]);
    }
  } else {
    // 標準モード: 同じ難易度同士 + 異なる難易度間の総当たり
    // まず同じ難易度同士（先手/後手バランス測定用）
    for (const player of players) {
      matchups.push([player, player]);
    }
    // 次に異なる難易度間
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const playerA = players[i];
        const playerB = players[j];
        if (playerA !== undefined && playerB !== undefined) {
          matchups.push([playerA, playerB]);
        }
      }
    }
  }

  return matchups;
}

interface JushuTask {
  jushuName: string;
  positions: [Position, Position, Position];
  isABlack: boolean;
}

/** 珠型セット制のタスクリストを生成 */
function buildJushuTasks(sets: number): JushuTask[] {
  const jushuNames = getAllJushuNames();
  const tasks: JushuTask[] = [];
  for (let set = 0; set < sets; set++) {
    for (const jushuName of jushuNames) {
      const positions = getJushuPositions(jushuName, true);
      if (!positions) {
        continue;
      }
      for (const isABlack of [true, false]) {
        tasks.push({ jushuName, positions, isABlack });
      }
    }
  }
  return tasks;
}

function normalizeWinner(
  rawWinner: "A" | "B" | "draw",
  isABlack: boolean,
): "A" | "B" | "draw" {
  if (rawWinner === "draw") {
    return "draw";
  }
  if (isABlack) {
    return rawWinner;
  }
  return rawWinner === "A" ? "B" : "A";
}

function updateMatchupResult(
  mr: MatchupResult,
  winner: "A" | "B" | "draw",
): void {
  switch (winner) {
    case "A":
      mr.winsA++;
      break;
    case "B":
      mr.winsB++;
      break;
    default:
      mr.draws++;
  }
}

function winnerToOutcome(winner: "A" | "B" | "draw"): "win" | "loss" | "draw" {
  if (winner === "A") {
    return "win";
  }
  if (winner === "B") {
    return "loss";
  }
  return "draw";
}

function updatePlayerRatings(
  ratings: Record<string, EloRating>,
  playerA: string,
  playerB: string,
  winner: "A" | "B" | "draw",
): void {
  const ratingA = ratings[playerA];
  const ratingB = ratings[playerB];
  if (!ratingA || !ratingB) {
    return;
  }
  const outcome = winnerToOutcome(winner);
  const updated = updateRatings(ratingA, ratingB, outcome);
  ratings[playerA] = updated.ratingA;
  ratings[playerB] = updated.ratingB;
}

/**
 * ステータス行を更新（同じ行を上書き）
 */
function writeStatus(message: string): void {
  process.stdout.write(`\r${message.padEnd(80)}`);
}

/**
 * ステータス行をクリアして改行
 */
function clearStatus(): void {
  process.stdout.write(`\r${" ".repeat(80)}\r`);
}

function runBenchmarkSequential(options: CliOptions): BenchmarkResult {
  const { players, sets, verbose, self: selfPlay } = options;
  const gamesPerSet = getAllJushuNames().length * 2; // 26珠型 × 2色

  console.log(
    `\n=== CPU AI Benchmark (Sequential${selfPlay ? ", Self-Play Only" : ""}) ===`,
  );
  console.log(`Players: ${players.join(", ")}`);
  console.log(`Sets: ${sets} (${gamesPerSet} games/set)`);
  if (selfPlay) {
    console.log(`Mode: Self-play only (excludes cross-difficulty matchups)`);
  } else {
    console.log(`Mode: Standard (includes same-difficulty + cross-difficulty)`);
  }
  console.log();

  const ratings: Record<string, EloRating> = {};
  for (const player of players) {
    ratings[player] = createInitialRating();
  }

  const matchups = generateMatchups(players, selfPlay);
  const matchupResults: MatchupResult[] = [];
  const allGames: GameResult[] = [];

  const totalMatchups = matchups.length;
  const gamesPerMatchup = sets * gamesPerSet;
  const totalGames = totalMatchups * gamesPerMatchup;

  console.log(`Total matchups: ${totalMatchups}`);
  console.log(`Total games: ${totalGames}`);
  console.log();

  let completedGames = 0;
  const benchStartTime = performance.now();

  for (const [playerA, playerB] of matchups) {
    console.log(`--- ${playerA} vs ${playerB} ---`);

    const matchupResult: MatchupResult = {
      playerA,
      playerB,
      winsA: 0,
      winsB: 0,
      draws: 0,
      total: gamesPerMatchup,
    };

    const jushuTasks = buildJushuTasks(sets);

    let matchupGameIndex = 0;
    for (const task of jushuTasks) {
      const { jushuName, positions, isABlack } = task;
      const configA: PlayerConfig = { id: playerA, difficulty: playerA };
      const configB: PlayerConfig = { id: playerB, difficulty: playerB };

      const black = isABlack ? configA : configB;
      const white = isABlack ? configB : configA;

      // ステータス行を更新
      const gameStartTime = performance.now();
      const elapsed = ((gameStartTime - benchStartTime) / 1000).toFixed(0);
      matchupGameIndex++;
      writeStatus(
        `[${elapsed}s] ${playerA} vs ${playerB}: ${jushuName} ${isABlack ? "A黒" : "A白"} ${matchupGameIndex}/${gamesPerMatchup} (${matchupResult.winsA}W-${matchupResult.winsB}L-${matchupResult.draws}D)`,
      );

      const result = runHeadlessGame(black, white, {
        verbose,
        openingMoves: positions,
      });

      const winner = normalizeWinner(result.winner, isABlack);
      updateMatchupResult(matchupResult, winner);
      updatePlayerRatings(ratings, playerA, playerB, winner);

      allGames.push({ ...result, playerA, playerB, winner, isABlack });
      completedGames++;

      // ゲーム終了後のステータス更新
      const gameEndTime = performance.now();
      const gameDuration = ((gameEndTime - gameStartTime) / 1000).toFixed(1);
      const totalElapsed = ((gameEndTime - benchStartTime) / 1000).toFixed(0);
      const progress = ((completedGames / totalGames) * 100).toFixed(1);
      const maxThinkTime = Math.max(...result.moveHistory.map((m) => m.time));

      writeStatus(
        `[${totalElapsed}s] ${jushuName} done - ${result.moves}手 ${gameDuration}s (max ${(maxThinkTime / 1000).toFixed(1)}s/手) ${result.reason}`,
      );

      if (matchupGameIndex % 10 === 0 || matchupGameIndex === gamesPerMatchup) {
        clearStatus();
        console.log(
          `  Game ${matchupGameIndex}/${gamesPerMatchup} (${progress}% total) - ${matchupResult.winsA}W-${matchupResult.winsB}L-${matchupResult.draws}D`,
        );
      }
    }

    matchupResults.push(matchupResult);
    clearStatus();

    const stats = calculateStats(
      allGames.filter(
        (g) =>
          (g.playerA === playerA && g.playerB === playerB) ||
          (g.playerA === playerB && g.playerB === playerA),
      ),
    );

    console.log(
      `  Result: ${matchupResult.winsA}-${matchupResult.winsB}-${matchupResult.draws}`,
    );
    console.log(`  Avg moves: ${stats.avgMoves.toFixed(1)}`);
    console.log(`  Avg duration: ${(stats.avgDuration / 1000).toFixed(2)}s`);
    console.log(
      `  Thinking time (${playerA}): avg=${stats.thinkingTimeA.avg.toFixed(0)}ms, max=${stats.thinkingTimeA.max.toFixed(0)}ms`,
    );
    console.log(
      `  Thinking time (${playerB}): avg=${stats.thinkingTimeB.avg.toFixed(0)}ms, max=${stats.thinkingTimeB.max.toFixed(0)}ms`,
    );
    console.log();
  }

  return {
    timestamp: new Date().toISOString(),
    options: {
      players,
      sets,
      gamesPerSet,
      parallel: false,
      workers: 1,
    },
    ratings,
    matchups: matchupResults,
    games: allGames,
  };
}

async function runBenchmarkParallel(
  options: CliOptions,
): Promise<BenchmarkResult> {
  const {
    players,
    sets,
    verbose,
    workers: numWorkers,
    self: selfPlay,
  } = options;
  const jushuNames = getAllJushuNames();
  const gamesPerSet = jushuNames.length * 2;

  console.log(
    `\n=== CPU AI Benchmark (Parallel: ${numWorkers} workers${selfPlay ? ", Self-Play Only" : ""}) ===`,
  );
  console.log(`Players: ${players.join(", ")}`);
  console.log(`Sets: ${sets} (${gamesPerSet} games/set)`);
  if (selfPlay) {
    console.log(`Mode: Self-play only (excludes cross-difficulty matchups)`);
  } else {
    console.log(`Mode: Standard (includes same-difficulty + cross-difficulty)`);
  }
  console.log();

  const matchups = generateMatchups(players, selfPlay);
  const totalMatchups = matchups.length;
  const gamesPerMatchup = sets * gamesPerSet;
  const totalGames = totalMatchups * gamesPerMatchup;

  console.log(`Total matchups: ${totalMatchups}`);
  console.log(`Total games: ${totalGames}`);
  console.log();

  // タスクを生成（珠型セット制）
  const tasks: GameTask[] = [];
  let taskId = 0;

  for (let matchupIndex = 0; matchupIndex < matchups.length; matchupIndex++) {
    const matchup = matchups[matchupIndex];
    if (!matchup) {
      continue;
    }

    const [playerA, playerB] = matchup;
    let gameIndex = 0;

    for (let set = 0; set < sets; set++) {
      for (const jushuName of jushuNames) {
        const positions = getJushuPositions(jushuName, true);
        if (!positions) {
          continue;
        }

        for (const isABlack of [true, false]) {
          const configA: PlayerConfig = { id: playerA, difficulty: playerA };
          const configB: PlayerConfig = { id: playerB, difficulty: playerB };

          tasks.push({
            taskId: taskId++,
            playerA: isABlack ? configA : configB,
            playerB: isABlack ? configB : configA,
            matchupIndex,
            gameIndex: gameIndex++,
            isABlack,
            openingMoves: positions,
            jushuName,
          });
        }
      }
    }
  }

  // ワーカーで並列実行
  const hasOverrides = Object.keys(options.scoreOverrides).length > 0;
  const results = await runTasksWithWorkers(
    tasks,
    numWorkers,
    verbose,
    totalGames,
    hasOverrides ? options.scoreOverrides : undefined,
  );

  // 結果を集計
  const ratings: Record<string, EloRating> = {};
  for (const player of players) {
    ratings[player] = createInitialRating();
  }

  const matchupResults: MatchupResult[] = matchups.map(
    ([playerA, playerB]) => ({
      playerA,
      playerB,
      winsA: 0,
      winsB: 0,
      draws: 0,
      total: gamesPerMatchup,
    }),
  );

  const allGames: GameResult[] = [];

  // タスクID順にソートして処理（レーティング計算の再現性のため）
  results.sort((a, b) => a.taskId - b.taskId);

  for (const { taskId: tid, result } of results) {
    const task = tasks[tid];
    if (!task) {
      continue;
    }

    const matchup = matchups[task.matchupIndex];
    const matchupResult = matchupResults[task.matchupIndex];
    if (!matchup || !matchupResult) {
      continue;
    }

    const [playerA, playerB] = matchup;

    // 結果を正規化
    const winner = normalizeWinner(result.winner, task.isABlack);

    updateMatchupResult(matchupResult, winner);

    const ratingA = ratings[playerA];
    const ratingB = ratings[playerB];
    if (ratingA && ratingB) {
      const updated = updateRatings(ratingA, ratingB, winnerToOutcome(winner));
      ratings[playerA] = updated.ratingA;
      ratings[playerB] = updated.ratingB;
    }

    allGames.push({
      ...result,
      playerA,
      playerB,
      winner,
      isABlack: task.isABlack,
    });
  }

  // マッチアップごとの統計を表示
  console.log();
  for (let i = 0; i < matchups.length; i++) {
    const matchup = matchups[i];
    const matchupResult = matchupResults[i];
    if (!matchup || !matchupResult) {
      continue;
    }

    const [playerA, playerB] = matchup;
    const matchupGames = allGames.filter(
      (g) =>
        (g.playerA === playerA && g.playerB === playerB) ||
        (g.playerA === playerB && g.playerB === playerA),
    );
    const stats = calculateStats(matchupGames);

    console.log(`--- ${playerA} vs ${playerB} ---`);
    console.log(
      `  Result: ${matchupResult.winsA}-${matchupResult.winsB}-${matchupResult.draws}`,
    );
    console.log(`  Avg moves: ${stats.avgMoves.toFixed(1)}`);
    console.log(`  Avg duration: ${(stats.avgDuration / 1000).toFixed(2)}s`);
    console.log(
      `  Thinking time (${playerA}): avg=${stats.thinkingTimeA.avg.toFixed(0)}ms, max=${stats.thinkingTimeA.max.toFixed(0)}ms`,
    );
    console.log(
      `  Thinking time (${playerB}): avg=${stats.thinkingTimeB.avg.toFixed(0)}ms, max=${stats.thinkingTimeB.max.toFixed(0)}ms`,
    );
  }

  return {
    timestamp: new Date().toISOString(),
    options: {
      players,
      sets,
      gamesPerSet,
      parallel: true,
      workers: numWorkers,
    },
    ratings,
    matchups: matchupResults,
    games: allGames,
  };
}

function runTasksWithWorkers(
  tasks: GameTask[],
  numWorkers: number,
  verbose: boolean,
  totalGames: number,
  scoreOverrides?: Partial<PatternScoreValues>,
): Promise<WorkerResult[]> {
  const results: WorkerResult[] = [];
  const taskQueue = [...tasks];
  let completedGames = 0;
  const startTime = performance.now();

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
          scoreOverrides,
          openingMoves: task.openingMoves,
        },
        execArgv: [
          "--experimental-strip-types",
          "--disable-warning=ExperimentalWarning",
          "--import",
          path.join(__dirname, "register-loader.mjs"),
        ],
      });

      worker.on("message", (result: WorkerResult) => {
        results.push(result);
        completedGames++;

        const elapsed = ((performance.now() - startTime) / 1000).toFixed(0);
        const pct = ((completedGames / totalGames) * 100).toFixed(1);
        writeStatus(
          `[${elapsed}s] Progress: ${completedGames}/${totalGames} (${pct}%)`,
        );

        activeWorkers--;
        startWorker();
      });

      worker.on("error", (err) => {
        console.error(`Worker error:`, err);
        activeWorkers--;
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

    // 初期ワーカーを起動
    const initialWorkers = Math.min(numWorkers, tasks.length);
    for (let i = 0; i < initialWorkers; i++) {
      startWorker();
    }
  });
}

function printResults(result: BenchmarkResult): void {
  console.log(`\n=== Final Ratings ===`);

  const sortedRatings = Object.entries(result.ratings).sort(
    (a, b) => b[1].rating - a[1].rating,
  );

  for (let i = 0; i < sortedRatings.length; i++) {
    const entry = sortedRatings[i];
    if (entry) {
      const [player, rating] = entry;
      console.log(`${i + 1}. ${player}: ${formatRating(rating)}`);
    }
  }

  console.log(`\n=== Matchup Summary ===`);
  for (const matchup of result.matchups) {
    console.log(
      `${matchup.playerA} vs ${matchup.playerB}: ${matchup.winsA}-${matchup.winsB}-${matchup.draws}`,
    );
  }
}

function saveResults(result: BenchmarkResult, options: CliOptions): void {
  const outputDir = options.output;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = result.timestamp.replace(/[:.]/g, "-");
  const filename = `bench-${timestamp}`;

  if (options.format === "json") {
    const filepath = path.join(outputDir, `${filename}.json`);
    fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
    console.log(`\nResults saved to: ${filepath}`);
  } else {
    const ratingsPath = path.join(outputDir, `${filename}-ratings.csv`);
    const matchupsPath = path.join(outputDir, `${filename}-matchups.csv`);

    const ratingsHeader = "player,rating,games,wins,losses,draws,winrate\n";
    const ratingsRows = Object.entries(result.ratings)
      .map(([player, r]) => {
        const winRate = r.games > 0 ? (r.wins / r.games) * 100 : 0;
        return `${player},${r.rating.toFixed(1)},${r.games},${r.wins},${r.losses},${r.draws},${winRate.toFixed(1)}`;
      })
      .join("\n");
    fs.writeFileSync(ratingsPath, ratingsHeader + ratingsRows);

    const matchupsHeader = "playerA,playerB,winsA,winsB,draws,total\n";
    const matchupsRows = result.matchups
      .map(
        (m) =>
          `${m.playerA},${m.playerB},${m.winsA},${m.winsB},${m.draws},${m.total}`,
      )
      .join("\n");
    fs.writeFileSync(matchupsPath, matchupsHeader + matchupsRows);

    console.log(`\nResults saved to:`);
    console.log(`  ${ratingsPath}`);
    console.log(`  ${matchupsPath}`);
  }
}

// メイン処理
async function main(): Promise<void> {
  const options = parseArgs();

  // スコアオーバーライドを適用（直列実行用。並列はワーカー側で適用）
  if (Object.keys(options.scoreOverrides).length > 0) {
    applyPatternScoreOverrides(options.scoreOverrides);
    console.log(`\nScore overrides applied:`);
    for (const [key, value] of Object.entries(options.scoreOverrides)) {
      console.log(`  ${key}: ${value}`);
    }
  }

  const result = options.parallel
    ? await runBenchmarkParallel(options)
    : runBenchmarkSequential(options);

  printResults(result);
  saveResults(result, options);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
