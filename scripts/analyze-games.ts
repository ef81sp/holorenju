#!/usr/bin/env node
/**
 * ベンチマーク棋譜分析 CLI
 *
 * 使用例:
 *   pnpm analyze:games                    # 全ベンチマーク結果を分析
 *   pnpm analyze:games --latest           # 最新のみ
 *   pnpm analyze:games --verbose          # 詳細ログ
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AnalysisResult,
  AnalysisSummary,
  BenchmarkResultFile,
  GameAnalysis,
  Tag,
} from "./types/analysis.ts";

import { analyzeBenchmarkFile } from "./lib/gameAnalyzer.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

interface CliOptions {
  latest: boolean;
  verbose: boolean;
  inputDir: string;
  outputDir: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  const options: CliOptions = {
    latest: false,
    verbose: false,
    inputDir: path.join(PROJECT_ROOT, "bench-results"),
    outputDir: path.join(PROJECT_ROOT, "analyzed-games"),
  };

  for (const arg of args) {
    if (arg === "--latest" || arg === "-l") {
      options.latest = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg.startsWith("--input=")) {
      options.inputDir = arg.slice("--input=".length);
    } else if (arg.startsWith("--output=")) {
      options.outputDir = arg.slice("--output=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
ベンチマーク棋譜分析 CLI

Usage:
  pnpm analyze:games [options]

Options:
  --latest, -l     最新のベンチマーク結果のみ分析
  --verbose, -v    詳細ログを表示
  --input=<dir>    入力ディレクトリ (default: bench-results)
  --output=<dir>   出力ディレクトリ (default: analyzed-games)
  --help, -h       ヘルプを表示

Examples:
  pnpm analyze:games
  pnpm analyze:games --latest --verbose
`);
}

/**
 * ベンチマーク結果ファイルを取得
 */
function getBenchmarkFiles(inputDir: string, latestOnly: boolean): string[] {
  if (!fs.existsSync(inputDir)) {
    console.error(`Error: Input directory not found: ${inputDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(inputDir)
    .filter((f) => f.startsWith("bench-") && f.endsWith(".json"))
    .map((f) => path.join(inputDir, f))
    .sort();

  if (files.length === 0) {
    console.error(`Error: No benchmark files found in ${inputDir}`);
    process.exit(1);
  }

  if (latestOnly) {
    const latest = files[files.length - 1];
    return latest ? [latest] : [];
  }

  return files;
}

/**
 * サマリーを計算
 */
function calculateSummary(games: GameAnalysis[]): AnalysisSummary {
  const tagCounts: Record<string, number> = {};
  const jushuCounts: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};
  let totalMoves = 0;

  for (const game of games) {
    totalMoves += game.totalMoves;

    // 勝因カウント
    reasonCounts[game.reason] = (reasonCounts[game.reason] ?? 0) + 1;

    // タグカウント（対局レベル）
    for (const tag of game.gameTags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;

      // 珠型カウント
      if (tag.startsWith("jushu:")) {
        const jushu = tag.slice(6);
        jushuCounts[jushu] = (jushuCounts[jushu] ?? 0) + 1;
      }
    }

    // タグカウント（手レベル）
    for (const move of game.moves) {
      for (const tag of move.tags) {
        // 対局レベルで既にカウント済みのタグはスキップ
        if (
          tag.startsWith("jushu:") ||
          tag === "diagonal" ||
          tag === "orthogonal"
        ) {
          continue;
        }
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    }
  }

  return {
    totalGames: games.length,
    totalMoves,
    tagCounts,
    jushuCounts,
    reasonCounts,
  };
}

/**
 * 分析結果からタグを集計
 */
function countTagsFromAnalyses(
  analyses: GameAnalysis[],
): Record<string, number> {
  const tags: Record<string, number> = {};
  for (const game of analyses) {
    for (const tag of game.gameTags) {
      tags[tag] = (tags[tag] ?? 0) + 1;
    }
  }
  return tags;
}

/**
 * 上位タグを表示
 */
function printTopTags(tags: Record<string, number>, limit = 10): void {
  const sortedTags = Object.entries(tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (sortedTags.length > 0) {
    console.log("  上位タグ:");
    for (const [tag, count] of sortedTags) {
      console.log(`    ${tag}: ${count}`);
    }
  }
}

/**
 * メイン処理
 */
function main(): void {
  const options = parseArgs();

  console.log("=== ベンチマーク棋譜分析 ===\n");

  const files = getBenchmarkFiles(options.inputDir, options.latest);
  console.log(`分析対象ファイル: ${files.length}件`);

  // 出力ディレクトリ作成
  if (!fs.existsSync(options.outputDir)) {
    fs.mkdirSync(options.outputDir, { recursive: true });
  }

  const allGames: GameAnalysis[] = [];
  const sourceFiles: string[] = [];

  for (const file of files) {
    const filename = path.basename(file);
    sourceFiles.push(filename);

    if (options.verbose) {
      console.log(`\n分析中: ${filename}`);
    }

    try {
      const content = fs.readFileSync(file, "utf-8");
      const benchResult: BenchmarkResultFile = JSON.parse(content);

      const analyses = analyzeBenchmarkFile(benchResult, filename);
      allGames.push(...analyses);

      if (options.verbose) {
        console.log(`  対局数: ${analyses.length}`);
        const fileTags = countTagsFromAnalyses(analyses);
        printTopTags(fileTags);
      }
    } catch (err) {
      console.error(`Error reading ${file}:`, err);
    }
  }

  // サマリー計算
  const summary = calculateSummary(allGames);

  // 結果出力
  const result: AnalysisResult = {
    timestamp: new Date().toISOString(),
    sourceFiles,
    games: allGames,
    summary,
  };

  const timestamp = result.timestamp.replace(/[:.]/g, "-");
  const outputFile = path.join(options.outputDir, `analysis-${timestamp}.json`);

  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  console.log(`\n結果を保存: ${outputFile}`);

  // サマリー表示
  console.log("\n=== サマリー ===");
  console.log(`総対局数: ${summary.totalGames}`);
  console.log(`総手数: ${summary.totalMoves}`);
  console.log(
    `平均手数: ${(summary.totalMoves / summary.totalGames).toFixed(1)}`,
  );

  console.log("\n勝因内訳:");
  for (const [reason, count] of Object.entries(summary.reasonCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    const percent = ((count / summary.totalGames) * 100).toFixed(1);
    console.log(`  ${reason}: ${count} (${percent}%)`);
  }

  console.log("\n珠型内訳:");
  for (const [jushu, count] of Object.entries(summary.jushuCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    const percent = ((count / summary.totalGames) * 100).toFixed(1);
    console.log(`  ${jushu}: ${count} (${percent}%)`);
  }

  console.log("\n主要タグ出現回数:");
  const importantTags: Tag[] = [
    "vcf-win",
    "four-three",
    "four",
    "open-three",
    "winning-move",
    "forbidden-loss",
    "forbidden-trap",
    "double-three",
    "double-four",
  ];

  for (const tag of importantTags) {
    const count = summary.tagCounts[tag] ?? 0;
    if (count > 0) {
      console.log(`  ${tag}: ${count}`);
    }
  }
}

main();
