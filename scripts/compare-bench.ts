/**
 * ベンチマーク比較スクリプト
 *
 * 2つのベンチマーク結果の思考時間・到達深度・ノード数を比較する。
 *
 * Usage:
 *   pnpm compare-bench <file1> <file2>
 *   pnpm compare-bench <file1> <file2> --matchup=hard
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface MoveEntry {
  row: number;
  col: number;
  time: number;
  isOpening?: boolean;
  depth?: number;
  stats?: {
    nodes?: number;
    completedDepth?: number;
    interrupted?: boolean;
    evaluationCalls?: number;
  };
}

interface GameEntry {
  playerA: string | { difficulty: string };
  playerB: string | { difficulty: string };
  winner: string;
  duration: number;
  moves: number;
  moveHistory: MoveEntry[];
}

interface BenchResult {
  games: GameEntry[];
}

function getDifficulty(player: string | { difficulty: string }): string {
  return typeof player === "string" ? player : player.difficulty;
}

function analyzeGames(
  games: GameEntry[],
  label: string,
  matchup?: string,
): void {
  // Filter by matchup
  const filtered = matchup
    ? games.filter((g) => {
        const a = getDifficulty(g.playerA);
        const b = getDifficulty(g.playerB);
        return a === matchup && b === matchup;
      })
    : games;

  if (filtered.length === 0) {
    console.log(
      `${label}: No games found${matchup ? ` for matchup=${matchup}` : ""}`,
    );
    return;
  }

  const thinkTimes: number[] = [];
  const depths: number[] = [];
  const nodes: number[] = [];
  const evalCalls: number[] = [];
  const nps: number[] = []; // nodes per second

  for (const g of filtered) {
    for (const m of g.moveHistory) {
      if (m.isOpening) {
        continue;
      }
      if (m.time > 0) {
        thinkTimes.push(m.time);
      }
      if (m.depth !== undefined) {
        depths.push(m.depth);
      }
      if (m.stats?.nodes !== undefined) {
        nodes.push(m.stats.nodes);
        if (m.time > 0) {
          nps.push(m.stats.nodes / (m.time / 1000));
        }
      }
      if (m.stats?.evaluationCalls !== undefined) {
        evalCalls.push(m.stats.evaluationCalls);
      }
    }
  }

  const avg = (arr: number[]): number =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const percentile = (arr: number[], p: number): number => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * p)] ?? 0;
  };

  console.log(
    `${label} (${filtered.length} games, ${thinkTimes.length} moves):`,
  );
  console.log(
    `  Think time:   avg=${avg(thinkTimes).toFixed(0)}ms  median=${percentile(thinkTimes, 0.5).toFixed(0)}ms  p90=${percentile(thinkTimes, 0.9).toFixed(0)}ms`,
  );
  console.log(
    `  Depth:        avg=${avg(depths).toFixed(1)}  median=${percentile(depths, 0.5)}  p90=${percentile(depths, 0.9)}`,
  );
  console.log(
    `  Nodes:        avg=${avg(nodes).toFixed(0)}  median=${percentile(nodes, 0.5).toFixed(0)}`,
  );
  console.log(
    `  NPS:          avg=${avg(nps).toFixed(0)}  median=${percentile(nps, 0.5).toFixed(0)}`,
  );
  console.log(
    `  Eval calls:   avg=${avg(evalCalls).toFixed(0)}  median=${percentile(evalCalls, 0.5).toFixed(0)}`,
  );
  console.log();
}

// --- main ---
const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const matchupArg = args.find((a) => a.startsWith("--matchup="));
const matchup = matchupArg?.split("=")[1];

if (files.length < 1) {
  console.log("Usage: pnpm compare-bench <file1> [file2] [--matchup=hard]");
  process.exit(1);
}

for (const file of files) {
  const resolved = path.resolve(file);
  const data: BenchResult = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  const label = path.basename(file);
  analyzeGames(data.games, label, matchup);
}
