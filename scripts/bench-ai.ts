/**
 * CPU AI ベンチマーク CLI
 *
 * 使用例:
 *   pnpm bench:ai                              # 全難易度総当たり
 *   pnpm bench:ai --players=medium,hard        # 特定難易度
 *   pnpm bench:ai --games=100 --verbose        # オプション指定
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  calculateStats,
  createInitialRating,
  formatRating,
  runHeadlessGame,
  updateRatings,
  type EloRating,
  type GameResult,
  type PlayerConfig,
} from "../src/logic/cpuAI/benchmark/index.ts";
import { CPU_DIFFICULTIES, type CpuDifficulty } from "../src/types/cpu.ts";

interface CliOptions {
  players: CpuDifficulty[];
  games: number;
  output: string;
  format: "json" | "csv";
  verbose: boolean;
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
  };
  ratings: Record<string, EloRating>;
  matchups: MatchupResult[];
  games: GameResult[];
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    players: [...CPU_DIFFICULTIES],
    games: 50,
    output: "bench-results",
    format: "json",
    verbose: false,
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
    } else if (arg.startsWith("--games=")) {
      const value = parseInt(arg.slice("--games=".length), 10);
      if (!isNaN(value) && value > 0) {
        options.games = value;
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
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
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
  --help, -h         Show this help message

Examples:
  pnpm bench:ai
  pnpm bench:ai --players=medium,hard --games=20
  pnpm bench:ai --verbose --format=csv
`);
}

function generateMatchups(
  players: CpuDifficulty[],
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

function runBenchmark(options: CliOptions): BenchmarkResult {
  const { players, games, verbose } = options;

  console.log(`\n=== CPU AI Benchmark ===`);
  console.log(`Players: ${players.join(", ")}`);
  console.log(`Games per matchup: ${games}`);
  console.log();

  // 初期レーティング
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
      // 先手/後手を交互に
      const isABlack = i % 2 === 0;

      const configA: PlayerConfig = { id: playerA, difficulty: playerA };
      const configB: PlayerConfig = { id: playerB, difficulty: playerB };

      const black = isABlack ? configA : configB;
      const white = isABlack ? configB : configA;

      const result = runHeadlessGame(black, white, { verbose });

      // 結果を正規化
      const normalizeWinner = (): "A" | "B" | "draw" => {
        if (result.winner === "draw") {
          return "draw";
        }
        if (isABlack) {
          return result.winner;
        }
        return result.winner === "A" ? "B" : "A";
      };
      const winner = normalizeWinner();

      // 統計更新
      if (winner === "A") {
        matchupResult.winsA++;
      } else if (winner === "B") {
        matchupResult.winsB++;
      } else {
        matchupResult.draws++;
      }

      // レーティング更新
      const ratingA = ratings[playerA];
      const ratingB = ratings[playerB];
      if (ratingA && ratingB) {
        const getOutcome = (): "win" | "loss" | "draw" => {
          if (winner === "A") {
            return "win";
          }
          if (winner === "B") {
            return "loss";
          }
          return "draw";
        };
        const updated = updateRatings(ratingA, ratingB, getOutcome());
        ratings[playerA] = updated.ratingA;
        ratings[playerB] = updated.ratingB;
      }

      // ゲーム結果を記録
      allGames.push({
        ...result,
        playerA,
        playerB,
        winner,
      });

      completedGames++;

      // 進捗表示
      if ((i + 1) % 10 === 0 || i + 1 === games) {
        const progress = ((completedGames / totalGames) * 100).toFixed(1);
        console.log(
          `  Game ${i + 1}/${games} (${progress}% total) - ${matchupResult.winsA}W-${matchupResult.winsB}L-${matchupResult.draws}D`,
        );
      }
    }

    matchupResults.push(matchupResult);

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
    console.log();
  }

  return {
    timestamp: new Date().toISOString(),
    options: {
      players,
      gamesPerMatchup: games,
    },
    ratings,
    matchups: matchupResults,
    games: allGames,
  };
}

function printResults(result: BenchmarkResult): void {
  console.log(`\n=== Final Ratings ===`);

  // レーティング順にソート
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

  // ディレクトリ作成
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
    // CSV 形式
    const ratingsPath = path.join(outputDir, `${filename}-ratings.csv`);
    const matchupsPath = path.join(outputDir, `${filename}-matchups.csv`);

    // Ratings CSV
    const ratingsHeader = "player,rating,games,wins,losses,draws,winrate\n";
    const ratingsRows = Object.entries(result.ratings)
      .map(([player, r]) => {
        const winRate = r.games > 0 ? (r.wins / r.games) * 100 : 0;
        return `${player},${r.rating.toFixed(1)},${r.games},${r.wins},${r.losses},${r.draws},${winRate.toFixed(1)}`;
      })
      .join("\n");
    fs.writeFileSync(ratingsPath, ratingsHeader + ratingsRows);

    // Matchups CSV
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
const options = parseArgs();
const result = runBenchmark(options);
printResults(result);
saveResults(result, options);
