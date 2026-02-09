#!/usr/bin/env node
/**
 * ベンチマーク結果分析 CLI
 *
 * 使用例:
 *   pnpm analyze:bench                     # 最新ファイルを分析
 *   pnpm analyze:bench <結果ファイル.json>  # 特定ファイルを分析
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { computeStats, formatStats } from "./lib/benchStatistics.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const BENCH_DIR = path.join(PROJECT_ROOT, "bench-results");

function findLatestFile(): string {
  if (!fs.existsSync(BENCH_DIR)) {
    console.error("Usage: pnpm analyze:bench <bench-result.json>");
    console.error("  or place results in bench-results/");
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
    console.error("Usage: pnpm analyze:bench <bench-result.json>");
    console.error("  or place results in bench-results/");
    process.exit(1);
  }

  return files[0].path;
}

function main(): void {
  const [, , arg] = process.argv;
  const filePath = arg ? path.resolve(arg) : findLatestFile();

  if (!fs.existsSync(filePath)) {
    console.error(`Usage: pnpm analyze:bench <bench-result.json>`);
    console.error(`  or place results in bench-results/`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(content);
  const stats = computeStats(data);
  const output = formatStats(stats, path.basename(filePath));
  process.stdout.write(output);
}

main();
