#!/usr/bin/env node
/**
 * オープニングブック資産ビルダー（opening-book-2026-07-16.md §2、v2: ★v2プラン）。
 *
 * trap-mining.ts --dump-book が出力した JSONL を読み込み、
 * src/assets/opening-book-hard.json（canonical key → { play, annotation }）を生成する。
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
 *
 *   # v2: Rapfi 誘導化（★v2プラン B1〜B3）。安全検証結果は --rapfi-cache に
 *   # 永続化され、次回以降の再ビルドで未変更分の再検証（~10秒/エントリ）を省く。
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/build-opening-book.ts --dump=bench-results/opening-book-dump.jsonl \
 *     --rapfi-moves=bench-results/rapfi-book-moves.jsonl \
 *     --rapfi-cache=bench-results/rapfi-verification-cache.jsonl \
 *     --out=src/assets/opening-book-hard.json --weight-gen=texel-r2
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";

import type { ForcedWinChecker } from "./lib/verifyBookBlocksTraps";

import { getGitRev } from "./lib/bookDumpMetadata";
import {
  applyPatches,
  applyRapfiGuidance,
  buildOpeningBookAsset,
  mergeBlackTrapIntoAsset,
  parseBlackTrapDumpJsonl,
  parseDumpJsonl,
  parsePatchJsonl,
  parseRapfiMovesJsonl,
  parseRapfiVerificationCacheJsonl,
  serializeRapfiVerificationCache,
} from "./lib/buildOpeningBook";
import { checkForcedWinAfterMove } from "./lib/forcedWinCheck";

interface CliOptions {
  dumpPath: string;
  outPath: string;
  weightGeneration: string;
  patchPath: string | null;
  blackTrapsOnlyPath: string | null;
  rapfiMovesPath: string | null;
  rapfiCachePath: string | null;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let dumpPath: string | null = null;
  let outPath = "src/assets/opening-book-hard.json";
  let weightGeneration = "unknown";
  let patchPath: string | null = null;
  let blackTrapsOnlyPath: string | null = null;
  let rapfiMovesPath: string | null = null;
  let rapfiCachePath: string | null = null;
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
    } else if (arg.startsWith("--rapfi-moves=")) {
      rapfiMovesPath = arg.slice("--rapfi-moves=".length);
    } else if (arg.startsWith("--rapfi-cache=")) {
      rapfiCachePath = arg.slice("--rapfi-cache=".length);
    }
  }
  if (!dumpPath) {
    throw new Error("--dump=<path> は必須です");
  }
  if (rapfiMovesPath && !rapfiCachePath) {
    throw new Error(
      "--rapfi-moves 指定時は --rapfi-cache=<path> も必須です（安全検証結果の永続化先）",
    );
  }
  return {
    dumpPath,
    outPath,
    weightGeneration,
    patchPath,
    blackTrapsOnlyPath,
    rapfiMovesPath,
    rapfiCachePath,
  };
}

async function main(): Promise<void> {
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
  if (opts.rapfiMovesPath) {
    console.log(`rapfi-moves: ${opts.rapfiMovesPath}`);
    console.log(`rapfi-cache: ${opts.rapfiCachePath}`);
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

  if (opts.rapfiMovesPath && opts.rapfiCachePath) {
    const { rapfiMovesPath, rapfiCachePath } = opts;

    const rapfiText = readFileSync(rapfiMovesPath, "utf-8");
    const rapfiEntries = parseRapfiMovesJsonl(rapfiText);
    console.log(`Rapfiエントリ数: ${rapfiEntries.length}`);

    const cache = existsSync(rapfiCachePath)
      ? parseRapfiVerificationCacheJsonl(readFileSync(rapfiCachePath, "utf-8"))
      : new Map<string, "VCF" | "VCT" | null>();
    console.log(`検証キャッシュ既存エントリ数: ${cache.size}`);

    await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
    const wasm = await loadWasmModule();
    const engine = new WasmSearchEngine(wasm);
    const checker: ForcedWinChecker = {
      check(board, sideToMove, move) {
        return checkForcedWinAfterMove(engine, board, sideToMove, move)
          .forcedWinKind;
      },
    };

    // 検証のたび逐次キャッシュへ追記する（実装レビュー suggestion:
    // 長時間実行中の途中クラッシュで検証結果が全消失しないように）。
    // onVerified は cache がまだ持っていない新規検証結果のときだけ呼ばれるため
    // （applyRapfiGuidance 側で cache ヒット時はスキップ済み）、追記のみで
    // 重複行は発生しない。
    mkdirSync(path.dirname(rapfiCachePath), { recursive: true });
    if (!existsSync(rapfiCachePath)) {
      writeFileSync(rapfiCachePath, "");
    }
    const onVerified = (entry: {
      canonicalKey: string;
      move: string;
      forcedWinKind: "VCF" | "VCT" | null;
    }): void => {
      appendFileSync(rapfiCachePath, `${JSON.stringify(entry)}\n`);
    };

    const { entries, report } = applyRapfiGuidance(
      asset.entries,
      rapfiEntries,
      checker,
      cache,
      onVerified,
    );
    asset.entries = entries;
    asset.stats.entryCount = Object.keys(asset.entries).length;

    // 完了後、キャッシュ全体（旧+新、Map による自動重複排除・整形済み）を
    // 正規形として一括書き出す（逐次追記分と内容は同じだが、複数回の実行を
    // またいだ蓄積で生じ得る整形の揺れを解消するため）。
    writeFileSync(rapfiCachePath, serializeRapfiVerificationCache(cache));

    console.log("");
    console.log("── Rapfi 誘導化レポート ──────────────");
    console.log(`  採用（play を Rapfi 手へ切替）:   ${report.adopted}`);
    console.log(`  却下（Rapfi候補が全て危険）:       ${report.rejected}`);
    console.log(`  対象外（canonicalize失敗等）:      ${report.unavailable}`);
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

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
