#!/usr/bin/env node
/**
 * オープニングブック資産ビルダー（opening-book-2026-07-16.md §2）。
 *
 * trap-mining.ts --dump-book が出力した JSONL を読み込み、
 * src/assets/opening-book-hard.json（canonical key → { move, randomPool? }）を生成する。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/build-opening-book.ts --dump=bench-results/opening-book-dump.jsonl \
 *     --out=src/assets/opening-book-hard.json --weight-gen=texel-r2
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { getGitRev } from "./lib/bookDumpMetadata";
import { buildOpeningBookAsset, parseDumpJsonl } from "./lib/buildOpeningBook";

interface CliOptions {
  dumpPath: string;
  outPath: string;
  weightGeneration: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let dumpPath: string | null = null;
  let outPath = "src/assets/opening-book-hard.json";
  let weightGeneration = "unknown";
  for (const arg of args) {
    if (arg.startsWith("--dump=")) {
      dumpPath = arg.slice("--dump=".length);
    } else if (arg.startsWith("--out=")) {
      outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--weight-gen=")) {
      weightGeneration = arg.slice("--weight-gen=".length);
    }
  }
  if (!dumpPath) {
    throw new Error("--dump=<path> は必須です");
  }
  return { dumpPath, outPath, weightGeneration };
}

function main(): void {
  const opts = parseArgs();

  console.log("========================================");
  console.log(" オープニングブック資産ビルダー");
  console.log("========================================");
  console.log(`dump: ${opts.dumpPath}`);
  console.log(`out:  ${opts.outPath}`);

  const dumpText = readFileSync(opts.dumpPath, "utf-8");
  const { metadata, nodes } = parseDumpJsonl(dumpText);
  console.log(`ダンプノード数: ${nodes.length}`);

  const asset = buildOpeningBookAsset({
    dumpMetadata: metadata,
    nodes,
    sourceDump: opts.dumpPath,
    buildGitRev: getGitRev(),
    weightGeneration: opts.weightGeneration,
  });

  const json = JSON.stringify(asset);
  mkdirSync(path.dirname(opts.outPath), { recursive: true });
  writeFileSync(opts.outPath, json);

  const gzipSize = gzipSync(Buffer.from(json)).length;

  console.log("");
  console.log("── 統計 ──────────────────────────");
  console.log(`  ダンプノード総数:       ${asset.stats.totalDumpNodes}`);
  console.log(`  マージ後ノード数:       ${asset.stats.mergedNodes}`);
  console.log(`  トラップノード数:       ${asset.stats.trapNodes}`);
  console.log(`  彗星型（非掲載）:       ${asset.stats.cometNodesSkipped}`);
  console.log(
    `  変換矛盾で除外:         ${asset.stats.inconsistentNodesSkipped}`,
  );
  console.log(`  エントリ数:             ${asset.stats.entryCount}`);
  console.log("");
  console.log("── 挙動不変レポート（ゲート3: Elo中立の静的保証） ──");
  console.log(
    `  非トラップ由来（hardMove完全一致・assert済み）: ${asset.stats.nonTrapEntryCount}`,
  );
  console.log(
    `  トラップ由来（検証済み生存手を採用）:           ${asset.stats.trapEntryCount}`,
  );
  const poolSizes = Object.keys(asset.stats.randomPoolSizeDistribution)
    .map(Number)
    .sort((a, b) => a - b);
  if (poolSizes.length === 0) {
    console.log("  randomPoolサイズ分布: (トラップ由来エントリなし)");
  } else {
    for (const size of poolSizes) {
      console.log(
        `  randomPoolサイズ=${size}: ${asset.stats.randomPoolSizeDistribution[size]}件`,
      );
    }
  }
  console.log("");
  console.log(
    `  生JSONサイズ:           ${json.length.toLocaleString()} bytes`,
  );
  console.log(`  gzip後サイズ:            ${gzipSize.toLocaleString()} bytes`);
  console.log("========================================");
  console.log(` ${opts.outPath} に出力しました`);
  console.log("========================================");
}

main();
