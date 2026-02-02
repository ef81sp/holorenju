/**
 * CPU AI ベンチマーク CLI
 *
 * 使用例:
 *   pnpm bench:ai                              # 全難易度総当たり
 *   pnpm bench:ai --players=medium,hard        # 特定難易度
 *   pnpm bench:ai --games=100 --verbose        # オプション指定
 *   pnpm bench:ai --parallel                   # 並列実行
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import {
  calculateStats,
  createInitialRating,
  formatRating,
  runHeadlessGame,
  updateRatings,
  type EloRating,
  type GameResult,
  type PlayerConfig,
} from '../src/logic/cpu/benchmark/index.ts';
import { CPU_DIFFICULTIES, type CpuDifficulty } from '../src/types/cpu.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface CliOptions {
  players: CpuDifficulty[];
  games: number;
  output: string;
  format: 'json' | 'csv';
  verbose: boolean;
  parallel: boolean;
  workers: number;
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
    gamesPerMatchup: number;
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
    games: 50,
    output: 'bench-results',
    format: 'json',
    verbose: false,
    parallel: false,
    workers: Math.max(1, cpuCount - 1),
  };

  for (const arg of args) {
    if (arg.startsWith('--players=')) {
      const value = arg.slice('--players='.length);
      const players = value
        .split(',')
        .filter((p): p is CpuDifficulty =>
          CPU_DIFFICULTIES.includes(p as CpuDifficulty)
        );
      if (players.length > 0) {
        options.players = players;
      }
    } else if (arg.startsWith('--games=')) {
      const value = parseInt(arg.slice('--games='.length), 10);
      if (!isNaN(value) && value > 0) {
        options.games = value;
      }
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
    } else if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length);
      if (value === 'json' || value === 'csv') {
        options.format = value;
      }
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--parallel' || arg === '-p') {
      options.parallel = true;
    } else if (arg.startsWith('--workers=')) {
      const value = parseInt(arg.slice('--workers='.length), 10);
      if (!isNaN(value) && value > 0) {
        options.workers = value;
        options.parallel = true;
      }
    } else if (arg === '--help' || arg === '-h') {
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
  --games=<n>        Number of games per matchup. Default: 50
  --output=<dir>     Output directory. Default: bench-results
  --format=<fmt>     Output format (json|csv). Default: json
  --verbose, -v      Enable verbose logging
  --parallel, -p     Enable parallel execution using worker threads
  --workers=<n>      Number of worker threads. Default: ${cpuCount - 1}
                     (implies --parallel)
  --help, -h         Show this help message

Examples:
  pnpm bench:ai
  pnpm bench:ai --players=medium,hard --games=20
  pnpm bench:ai --parallel --workers=4
  pnpm bench:ai --verbose --format=csv
`);
}

function generateMatchups(
  players: CpuDifficulty[]
): [CpuDifficulty, CpuDifficulty][] {
  const matchups: [CpuDifficulty, CpuDifficulty][] = [];

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const playerA = players[i];
      const playerB = players[j];
      if (playerA !== undefined && playerB !== undefined) {
        matchups.push([playerA, playerB]);
      }
    }
  }

  return matchups;
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
  process.stdout.write('\r' + ' '.repeat(80) + '\r');
}

function runBenchmarkSequential(options: CliOptions): BenchmarkResult {
  const { players, games, verbose } = options;

  console.log(`\n=== CPU AI Benchmark (Sequential) ===`);
  console.log(`Players: ${players.join(', ')}`);
  console.log(`Games per matchup: ${games}`);
  console.log();

  const ratings: Record<string, EloRating> = {};
  for (const player of players) {
    ratings[player] = createInitialRating();
  }

  const matchups = generateMatchups(players);
  const matchupResults: MatchupResult[] = [];
  const allGames: GameResult[] = [];

  const totalMatchups = matchups.length;
  const totalGames = totalMatchups * games;

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
      total: games,
    };

    for (let i = 0; i < games; i++) {
      const isABlack = i % 2 === 0;

      const configA: PlayerConfig = { id: playerA, difficulty: playerA };
      const configB: PlayerConfig = { id: playerB, difficulty: playerB };

      const black = isABlack ? configA : configB;
      const white = isABlack ? configB : configA;

      // ステータス行を更新
      const gameStartTime = performance.now();
      const elapsed = ((gameStartTime - benchStartTime) / 1000).toFixed(0);
      writeStatus(
        `[${elapsed}s] ${playerA} vs ${playerB}: Game ${i + 1}/${games} (${matchupResult.winsA}W-${matchupResult.winsB}L-${matchupResult.draws}D) - playing...`
      );

      const result = runHeadlessGame(black, white, { verbose });

      const normalizeWinner = (): 'A' | 'B' | 'draw' => {
        if (result.winner === 'draw') {
          return 'draw';
        }
        if (isABlack) {
          return result.winner;
        }
        return result.winner === 'A' ? 'B' : 'A';
      };
      const winner = normalizeWinner();

      if (winner === 'A') {
        matchupResult.winsA++;
      } else if (winner === 'B') {
        matchupResult.winsB++;
      } else {
        matchupResult.draws++;
      }

      const ratingA = ratings[playerA];
      const ratingB = ratings[playerB];
      if (ratingA && ratingB) {
        const getOutcome = (): 'win' | 'loss' | 'draw' => {
          if (winner === 'A') {
            return 'win';
          }
          if (winner === 'B') {
            return 'loss';
          }
          return 'draw';
        };
        const updated = updateRatings(ratingA, ratingB, getOutcome());
        ratings[playerA] = updated.ratingA;
        ratings[playerB] = updated.ratingB;
      }

      allGames.push({
        ...result,
        playerA,
        playerB,
        winner,
        isABlack,
      });

      completedGames++;

      // ゲーム終了後のステータス更新
      const gameEndTime = performance.now();
      const gameDuration = ((gameEndTime - gameStartTime) / 1000).toFixed(1);
      const totalElapsed = ((gameEndTime - benchStartTime) / 1000).toFixed(0);
      const progress = ((completedGames / totalGames) * 100).toFixed(1);

      // 最長思考時間を計算
      const maxThinkTime = Math.max(...result.moveHistory.map(m => m.time));

      writeStatus(
        `[${totalElapsed}s] ${playerA} vs ${playerB}: Game ${i + 1}/${games} done - ${result.moves}手 ${gameDuration}s (max ${(maxThinkTime / 1000).toFixed(1)}s/手) ${result.reason}`
      );

      if ((i + 1) % 10 === 0 || i + 1 === games) {
        clearStatus();
        console.log(
          `  Game ${i + 1}/${games} (${progress}% total) - ${matchupResult.winsA}W-${matchupResult.winsB}L-${matchupResult.draws}D`
        );
      }
    }

    matchupResults.push(matchupResult);
    clearStatus();

    const stats = calculateStats(
      allGames.filter(
        g =>
          (g.playerA === playerA && g.playerB === playerB) ||
          (g.playerA === playerB && g.playerB === playerA)
      )
    );

    console.log(
      `  Result: ${matchupResult.winsA}-${matchupResult.winsB}-${matchupResult.draws}`
    );
    console.log(`  Avg moves: ${stats.avgMoves.toFixed(1)}`);
    console.log(`  Avg duration: ${(stats.avgDuration / 1000).toFixed(2)}s`);
    console.log(
      `  Thinking time (${playerA}): avg=${stats.thinkingTimeA.avg.toFixed(0)}ms, max=${stats.thinkingTimeA.max.toFixed(0)}ms`
    );
    console.log(
      `  Thinking time (${playerB}): avg=${stats.thinkingTimeB.avg.toFixed(0)}ms, max=${stats.thinkingTimeB.max.toFixed(0)}ms`
    );
    console.log();
  }

  return {
    timestamp: new Date().toISOString(),
    options: {
      players,
      gamesPerMatchup: games,
      parallel: false,
      workers: 1,
    },
    ratings,
    matchups: matchupResults,
    games: allGames,
  };
}

async function runBenchmarkParallel(
  options: CliOptions
): Promise<BenchmarkResult> {
  const { players, games, verbose, workers: numWorkers } = options;

  console.log(`\n=== CPU AI Benchmark (Parallel: ${numWorkers} workers) ===`);
  console.log(`Players: ${players.join(', ')}`);
  console.log(`Games per matchup: ${games}`);
  console.log();

  const matchups = generateMatchups(players);
  const totalMatchups = matchups.length;
  const totalGames = totalMatchups * games;

  console.log(`Total matchups: ${totalMatchups}`);
  console.log(`Total games: ${totalGames}`);
  console.log();

  // タスクを生成
  const tasks: GameTask[] = [];
  let taskId = 0;

  for (let matchupIndex = 0; matchupIndex < matchups.length; matchupIndex++) {
    const matchup = matchups[matchupIndex];
    if (!matchup) {
      continue;
    }

    const [playerA, playerB] = matchup;

    for (let gameIndex = 0; gameIndex < games; gameIndex++) {
      const isABlack = gameIndex % 2 === 0;

      const configA: PlayerConfig = { id: playerA, difficulty: playerA };
      const configB: PlayerConfig = { id: playerB, difficulty: playerB };

      tasks.push({
        taskId: taskId++,
        playerA: isABlack ? configA : configB,
        playerB: isABlack ? configB : configA,
        matchupIndex,
        gameIndex,
        isABlack,
      });
    }
  }

  // ワーカーで並列実行
  const results = await runTasksWithWorkers(
    tasks,
    numWorkers,
    verbose,
    totalGames
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
      total: games,
    })
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
    const normalizeWinner = (): 'A' | 'B' | 'draw' => {
      if (result.winner === 'draw') {
        return 'draw';
      }
      if (task.isABlack) {
        return result.winner;
      }
      return result.winner === 'A' ? 'B' : 'A';
    };
    const winner = normalizeWinner();

    if (winner === 'A') {
      matchupResult.winsA++;
    } else if (winner === 'B') {
      matchupResult.winsB++;
    } else {
      matchupResult.draws++;
    }

    const ratingA = ratings[playerA];
    const ratingB = ratings[playerB];
    if (ratingA && ratingB) {
      const getOutcome = (): 'win' | 'loss' | 'draw' => {
        if (winner === 'A') {
          return 'win';
        }
        if (winner === 'B') {
          return 'loss';
        }
        return 'draw';
      };
      const updated = updateRatings(ratingA, ratingB, getOutcome());
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
      g =>
        (g.playerA === playerA && g.playerB === playerB) ||
        (g.playerA === playerB && g.playerB === playerA)
    );
    const stats = calculateStats(matchupGames);

    console.log(`--- ${playerA} vs ${playerB} ---`);
    console.log(
      `  Result: ${matchupResult.winsA}-${matchupResult.winsB}-${matchupResult.draws}`
    );
    console.log(`  Avg moves: ${stats.avgMoves.toFixed(1)}`);
    console.log(`  Avg duration: ${(stats.avgDuration / 1000).toFixed(2)}s`);
    console.log(
      `  Thinking time (${playerA}): avg=${stats.thinkingTimeA.avg.toFixed(0)}ms, max=${stats.thinkingTimeA.max.toFixed(0)}ms`
    );
    console.log(
      `  Thinking time (${playerB}): avg=${stats.thinkingTimeB.avg.toFixed(0)}ms, max=${stats.thinkingTimeB.max.toFixed(0)}ms`
    );
  }

  return {
    timestamp: new Date().toISOString(),
    options: {
      players,
      gamesPerMatchup: games,
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
  totalGames: number
): Promise<WorkerResult[]> {
  const results: WorkerResult[] = [];
  const taskQueue = [...tasks];
  let completedGames = 0;
  let lastProgress = 0;

  const workerScript = path.join(__dirname, 'game-worker.ts');

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
          '--experimental-strip-types',
          '--disable-warning=ExperimentalWarning',
          '--import',
          path.join(__dirname, 'register-loader.mjs'),
        ],
      });

      worker.on('message', (result: WorkerResult) => {
        results.push(result);
        completedGames++;

        // 進捗表示（10%ごと）
        const progress = Math.floor((completedGames / totalGames) * 10);
        if (progress > lastProgress) {
          lastProgress = progress;
          console.log(
            `  Progress: ${completedGames}/${totalGames} (${progress * 10}%)`
          );
        }

        activeWorkers--;
        startWorker();
      });

      worker.on('error', err => {
        console.error(`Worker error:`, err);
        activeWorkers--;
        if (!finished) {
          finished = true;
          reject(err);
        }
      });

      worker.on('exit', code => {
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
    (a, b) => b[1].rating - a[1].rating
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
      `${matchup.playerA} vs ${matchup.playerB}: ${matchup.winsA}-${matchup.winsB}-${matchup.draws}`
    );
  }
}

function saveResults(result: BenchmarkResult, options: CliOptions): void {
  const outputDir = options.output;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = result.timestamp.replace(/[:.]/g, '-');
  const filename = `bench-${timestamp}`;

  if (options.format === 'json') {
    const filepath = path.join(outputDir, `${filename}.json`);
    fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
    console.log(`\nResults saved to: ${filepath}`);
  } else {
    const ratingsPath = path.join(outputDir, `${filename}-ratings.csv`);
    const matchupsPath = path.join(outputDir, `${filename}-matchups.csv`);

    const ratingsHeader = 'player,rating,games,wins,losses,draws,winrate\n';
    const ratingsRows = Object.entries(result.ratings)
      .map(([player, r]) => {
        const winRate = r.games > 0 ? (r.wins / r.games) * 100 : 0;
        return `${player},${r.rating.toFixed(1)},${r.games},${r.wins},${r.losses},${r.draws},${winRate.toFixed(1)}`;
      })
      .join('\n');
    fs.writeFileSync(ratingsPath, ratingsHeader + ratingsRows);

    const matchupsHeader = 'playerA,playerB,winsA,winsB,draws,total\n';
    const matchupsRows = result.matchups
      .map(
        m =>
          `${m.playerA},${m.playerB},${m.winsA},${m.winsB},${m.draws},${m.total}`
      )
      .join('\n');
    fs.writeFileSync(matchupsPath, matchupsHeader + matchupsRows);

    console.log(`\nResults saved to:`);
    console.log(`  ${ratingsPath}`);
    console.log(`  ${matchupsPath}`);
  }
}

// メイン処理
async function main(): Promise<void> {
  const options = parseArgs();

  const result = options.parallel
    ? await runBenchmarkParallel(options)
    : runBenchmarkSequential(options);

  printResults(result);
  saveResults(result, options);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
