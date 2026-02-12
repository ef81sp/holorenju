#!/usr/bin/env node
/**
 * ベンチマーク深掘り分析 CLI
 *
 * 使用例:
 *   pnpm analyze:deep                         # 最新ファイルの全分析
 *   pnpm analyze:deep --blunders              # blunder分布のみ
 *   pnpm analyze:deep --squandered            # advantage-squanderedのみ
 *   pnpm analyze:deep --tpe                   # time-pressure-errorのみ
 *   pnpm analyze:deep --game=35               # 特定ゲームの手順表示
 *   pnpm analyze:deep --file=<file.json>      # 特定ファイル指定
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { GameResult } from "../src/logic/cpu/benchmark/headless.ts";

import {
  analyzeAdvantageSquandered,
  analyzeBlunderDistribution,
  analyzeTimePressureErrors,
  formatAdvantageSquandered,
  formatBlunderDistribution,
  formatGameMoves,
  formatTimePressureErrors,
  getGameMoves,
} from "./lib/benchDeepDive.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const BENCH_DIR = path.join(PROJECT_ROOT, "bench-results");

interface CliOptions {
  file: string | null;
  blunders: boolean;
  squandered: boolean;
  tpe: boolean;
  game: number | null;
  all: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  const options: CliOptions = {
    file: null,
    blunders: false,
    squandered: false,
    tpe: false,
    game: null,
    all: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--file=")) {
      options.file = arg.slice("--file=".length);
    } else if (arg === "--blunders") {
      options.blunders = true;
    } else if (arg === "--squandered") {
      options.squandered = true;
    } else if (arg === "--tpe") {
      options.tpe = true;
    } else if (arg.startsWith("--game=")) {
      const value = parseInt(arg.slice("--game=".length), 10);
      if (!isNaN(value) && value >= 0) {
        options.game = value;
      }
    } else if (!arg.startsWith("--")) {
      options.file = arg;
    }
  }

  // フラグなし → 全分析
  if (
    !options.blunders &&
    !options.squandered &&
    !options.tpe &&
    options.game === null
  ) {
    options.all = true;
  }

  return options;
}

function findLatestFile(): string {
  if (!fs.existsSync(BENCH_DIR)) {
    console.error("Error: bench-results/ ディレクトリが見つかりません");
    process.exit(1);
  }

  const files = fs
    .readdirSync(BENCH_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      path: path.join(BENCH_DIR, f),
      mtime: fs.statSync(path.join(BENCH_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    console.error("Error: bench-results/ にJSONファイルがありません");
    process.exit(1);
  }

  return files[0].path;
}

function main(): void {
  const options = parseArgs();
  const filePath = options.file ? path.resolve(options.file) : findLatestFile();

  if (!fs.existsSync(filePath)) {
    console.error(`Error: ファイルが見つかりません: ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(content) as { games: GameResult[] };
  const { games } = data;

  console.log(
    `=== 深掘り分析: ${path.basename(filePath)} (${games.length}局) ===\n`,
  );

  if (options.all || options.blunders) {
    console.log(formatBlunderDistribution(analyzeBlunderDistribution(games)));
    console.log("");
  }

  if (options.all || options.squandered) {
    console.log(formatAdvantageSquandered(analyzeAdvantageSquandered(games)));
    console.log("");
  }

  if (options.all || options.tpe) {
    console.log(formatTimePressureErrors(analyzeTimePressureErrors(games)));
    console.log("");
  }

  if (options.game !== null) {
    if (options.game >= games.length) {
      console.error(
        `Error: game ${options.game} は範囲外です (0-${games.length - 1})`,
      );
      process.exit(1);
    }
    const game = games[options.game];
    console.log(formatGameMoves(game, options.game, getGameMoves(game)));
    console.log("");
  }

  console.log("=== 分析完了 ===");
}

main();
