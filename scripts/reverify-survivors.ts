#!/usr/bin/env node
/**
 * トラップノードの生存手を決定化した予算で直列に再検証する
 * （opening-book-2026-07-16.md §5 ゲート1 実行時に発覚した非決定性の根治）。
 *
 * --dump-book の権威ダンプは6並列負荷下で生成されており、生存手判定に使う
 * VCF/VCT の予算が timeLimit=5s の時間ベースだったため、実効探索量が
 * wall-clock 由来で変動し、非決定的だった（ゲート1初回実行: severity-A 60件中
 * 49 PASS・11 FAIL。うち10件は直列再チェックで生存手が覆った）。
 *
 * forcedWinCheck.ts の予算をノード数優位（timeLimit=60s安全弁・maxNodes=500k
 * 実効上限）に決定化した上で、全トラップノードの survivorMoves を直列に
 * 再チェックする。覆った（再チェックで強制勝ちが生じた）生存手はプールから
 * 除去する。プールが空になったノードは彗星型に降格する（そのまま
 * survivorMoves: [] を書き込み、以後 comet-mini-mining.ts の対象にする）。
 *
 * 出力は元と同じスキーマ（メタデータ行 + ノード行）の JSONL。トラップでない
 * ノード・彗星ノードはそのまま素通しする。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/reverify-survivors.ts --dump=bench-results/opening-book-dump.jsonl \
 *     --out=bench-results/opening-book-dump-reverified.jsonl
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import { createBoardFromRecord, parseMove } from "@/logic/gameRecordParser";

import type { BookDumpNode } from "./lib/trapPipeline";

import { checkForcedWinAfterMove } from "./lib/forcedWinCheck";

interface CliOptions {
  dumpPath: string;
  outPath: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    dumpPath: "bench-results/opening-book-dump.jsonl",
    outPath: "bench-results/opening-book-dump-reverified.jsonl",
  };
  for (const arg of args) {
    if (arg.startsWith("--dump=")) {
      opts.dumpPath = arg.slice("--dump=".length);
    } else if (arg.startsWith("--out=")) {
      opts.outPath = arg.slice("--out=".length);
    }
  }
  return opts;
}

function readDumpLines(dumpPath: string): {
  metadataLine: string;
  nodes: BookDumpNode[];
} {
  const lines = readFileSync(dumpPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const [metadataLine, ...nodeLines] = lines;
  if (!metadataLine) {
    throw new Error("ダンプが空です（メタデータ行がありません）");
  }
  const nodes = nodeLines.map((line) => JSON.parse(line) as BookDumpNode);
  return { metadataLine, nodes };
}

function isReverifiableTrapNode(node: BookDumpNode): boolean {
  return (
    node.ply === 8 &&
    node.forcedWinKind !== null &&
    (node.survivorMoves?.length ?? 0) > 0
  );
}

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log("========================================");
  console.log(" 生存手の直列再検証（決定化予算）");
  console.log("========================================");
  console.log(`dump: ${opts.dumpPath}`);
  console.log(`out:  ${opts.outPath}`);

  const { metadataLine, nodes } = readDumpLines(opts.dumpPath);
  const targets = nodes.filter(isReverifiableTrapNode);
  console.log(`再検証対象トラップノード: ${targets.length}件`);

  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  let overturnedCount = 0;
  let downgradedCount = 0;
  let updatedPoolCount = 0;

  const updatedNodes: BookDumpNode[] = nodes.map((n) => ({ ...n }));

  for (let i = 0; i < updatedNodes.length; i++) {
    const node = updatedNodes[i]!;
    if (!isReverifiableTrapNode(node)) {
      continue;
    }

    console.log("");
    console.log(`  route=${node.route} moves=${node.movesUpToHere.join(" ")}`);
    const { board } = createBoardFromRecord(node.movesUpToHere.join(" "));

    const survivors: string[] = [];
    for (const s of node.survivorMoves!) {
      const move = parseMove(s);
      const result = checkForcedWinAfterMove(engine, board, "white", move);
      if (result.forcedWinKind === null) {
        survivors.push(s);
      } else {
        overturnedCount++;
        console.log(
          `    ✗ 生存手 ${s} が覆りました（${result.forcedWinKind}）`,
        );
      }
    }

    if (survivors.length === node.survivorMoves!.length) {
      console.log("    ✓ 全生存手が再チェックでも安全（変更なし）");
    } else {
      updatedNodes[i] = { ...node, survivorMoves: survivors };
      if (survivors.length === 0) {
        downgradedCount++;
        console.log("    → 彗星型に降格（生存手ゼロ）");
      } else {
        updatedPoolCount++;
        console.log(`    → プール更新: ${survivors.join(", ")}`);
      }
    }
  }

  console.log("");
  console.log("========================================");
  console.log(` 覆った生存手: ${overturnedCount}件`);
  console.log(` プール更新（一部除去）: ${updatedPoolCount}件`);
  console.log(` 彗星型に降格: ${downgradedCount}件`);
  console.log("========================================");

  mkdirSync(path.dirname(opts.outPath), { recursive: true });
  const outLines = [
    metadataLine,
    ...updatedNodes.map((n) => JSON.stringify(n)),
  ];
  writeFileSync(opts.outPath, `${outLines.join("\n")}\n`);
  console.log(`再検証済みダンプを ${opts.outPath} に出力しました`);
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
