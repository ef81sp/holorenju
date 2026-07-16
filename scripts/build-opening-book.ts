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
 *
 *   # 彗星ルート個別対応（§4）: comet-mini-mining.ts が出力した patch を適用
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/build-opening-book.ts --dump=bench-results/opening-book-dump.jsonl \
 *     --patch=bench-results/comet-patch.jsonl \
 *     --out=src/assets/opening-book-hard.json --weight-gen=texel-r2
 *
 *   # 黒番トラップ個別対応（最小構成）: 黒ダンプからトラップノードだけを抽出して
 *   # マージする（黒ダンプ全体は焼き込まない）
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/build-opening-book.ts --dump=bench-results/opening-book-dump.jsonl \
 *     --black-traps-only=bench-results/opening-book-dump-black.jsonl \
 *     --out=src/assets/opening-book-hard.json --weight-gen=texel-r2
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { getGitRev } from "./lib/bookDumpMetadata";
import {
  applyPatches,
  buildOpeningBookAsset,
  mergeBlackTrapIntoAsset,
  parseBlackTrapDumpJsonl,
  parseDumpJsonl,
  parsePatchJsonl,
} from "./lib/buildOpeningBook";

interface CliOptions {
  dumpPath: string;
  outPath: string;
  weightGeneration: string;
  patchPath: string | null;
  blackTrapsOnlyPath: string | null;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let dumpPath: string | null = null;
  let outPath = "src/assets/opening-book-hard.json";
  let weightGeneration = "unknown";
  let patchPath: string | null = null;
  let blackTrapsOnlyPath: string | null = null;
  for (const arg of args) {
    if (arg.startsWith("--dump=")) {
      dumpPath = arg.slice("--dump=".length);
    } else if (arg.startsWith("--out=")) {
      outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--weight-gen=")) {
      weightGeneration = arg.slice("--weight-gen=".length);
    } else if (arg.startsWith("--patch=")) {
      patchPath = arg.slice("--patch=".length);
    } else if (arg.startsWith("--black-traps-only=")) {
      blackTrapsOnlyPath = arg.slice("--black-traps-only=".length);
    }
  }
  if (!dumpPath) {
    throw new Error("--dump=<path> は必須です");
  }
  return { dumpPath, outPath, weightGeneration, patchPath, blackTrapsOnlyPath };
}

function main(): void {
  const opts = parseArgs();

  console.log("========================================");
  console.log(" オープニングブック資産ビルダー");
  console.log("========================================");
  console.log(`dump: ${opts.dumpPath}`);
  console.log(`out:  ${opts.outPath}`);
  if (opts.patchPath) {
    console.log(`patch: ${opts.patchPath}`);
  }
  if (opts.blackTrapsOnlyPath) {
    console.log(`black-traps-only: ${opts.blackTrapsOnlyPath}`);
  }

  const dumpText = readFileSync(opts.dumpPath, "utf-8");
  const { metadata, nodes } = parseDumpJsonl(dumpText);
  console.log(`ダンプノード数: ${nodes.length}`);

  let asset = buildOpeningBookAsset({
    dumpMetadata: metadata,
    nodes,
    sourceDump: opts.dumpPath,
    buildGitRev: getGitRev(),
    weightGeneration: opts.weightGeneration,
  });

  let patchAppliedCount = 0;
  if (opts.patchPath) {
    const patchText = readFileSync(opts.patchPath, "utf-8");
    const patches = parsePatchJsonl(patchText);
    console.log(`patchエントリ数: ${patches.length}`);
    const applied = applyPatches(asset.entries, patches);
    asset.entries = applied.entries;
    patchAppliedCount = applied.appliedCount;
    // patch適用後の実際のエントリ数に更新する（新規追加分もあり得るため）。
    asset.stats.entryCount = Object.keys(asset.entries).length;
  }

  if (opts.blackTrapsOnlyPath) {
    const blackDumpText = readFileSync(opts.blackTrapsOnlyPath, "utf-8");
    const { metadata: blackMetadata, trapNodes } =
      parseBlackTrapDumpJsonl(blackDumpText);
    console.log(`黒トラップノード数: ${trapNodes.length}`);
    asset = mergeBlackTrapIntoAsset(asset, {
      sourceDump: opts.blackTrapsOnlyPath,
      dumpMetadata: blackMetadata,
      trapNodes,
    });
  }

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
  if (opts.patchPath) {
    console.log(`  patch適用数:            ${patchAppliedCount}`);
  }
  if (asset.blackTrapProvenance) {
    console.log(
      `  黒トラップ個別対応:     ${asset.blackTrapProvenance.entryCount}件` +
        `（由来: ${asset.blackTrapProvenance.sourceDump}）`,
    );
  }
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
