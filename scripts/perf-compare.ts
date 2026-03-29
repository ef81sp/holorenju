#!/usr/bin/env node
/**
 * WASM vs TS パフォーマンス比較スクリプト
 *
 * 指定棋譜の各白番手でTS版とWASM版の思考時間を比較する。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/perf-compare.ts
 */

import { performance } from "node:perf_hooks";

import { FULL_EVAL_OPTIONS } from "../src/logic/cpu/evaluation/patternScores.ts";
import { findBestMoveIterativeWithTT } from "../src/logic/cpu/search/iterativeDeepening.ts";
import { globalTT } from "../src/logic/cpu/transpositionTable.ts";
import { loadWasmModule } from "../src/logic/cpu/wasm/loader.ts";
import { WasmSearchEngine } from "../src/logic/cpu/wasm/searchEngine.ts";
import {
  createBoardFromRecord,
  formatMove,
  parseGameRecord,
} from "../src/logic/gameRecordParser.ts";

const KIFU =
  "H8 H9 J10 I9 G9 I7 I10 H10 J8 I8 J7 J6 J9 J11 K8 L7 I6 H5 G11 H11 H12 F10 K9 L8 G13 I11 K11 K7 L9 M10 G12 G10 M9 N9 K12 K10 J12 I12 L10";

// hard相当パラメータ
const MAX_DEPTH = 4;
const TIME_LIMIT = 8000;
const MAX_NODES = 600_000;

interface MoveResult {
  moveNum: number;
  moveStr: string;
  tsTimeMs: number;
  wasmTimeMs: number;
  tsMove: string;
  wasmMove: string;
  tsScore: number;
  wasmScore: number;
  tsDepth: number;
  wasmDepth: number;
  moveMatch: boolean;
}

async function main(): Promise<void> {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);
  const moves = parseGameRecord(KIFU);

  console.log("=== WASM vs TS パフォーマンス比較 ===");
  console.log(`棋譜: ${KIFU}`);
  console.log(
    `パラメータ: maxDepth=${MAX_DEPTH}, timeLimit=${TIME_LIMIT}ms, maxNodes=${MAX_NODES}`,
  );
  console.log();

  const results: MoveResult[] = [];

  // 各白番手(偶数インデックス=2手目,4手目,...)で計測
  for (let i = 1; i < moves.length; i += 2) {
    const moveNum = i + 1; // 1-indexed
    const move = moves[i];
    if (!move) {
      continue;
    }

    const expectedMoveStr = formatMove(move.position);

    // i手目までの盤面を構築（白が考える局面 = i手目を打つ前）
    const { board } = createBoardFromRecord(KIFU, i);

    // --- TS版 ---
    globalTT.clear();
    const tsStart = performance.now();
    const tsResult = findBestMoveIterativeWithTT({
      board,
      color: "white",
      maxDepth: MAX_DEPTH,
      timeLimit: TIME_LIMIT,
      randomFactor: 0,
      evaluationOptions: FULL_EVAL_OPTIONS,
      maxNodes: MAX_NODES,
    });
    const tsTime = performance.now() - tsStart;

    // --- WASM版 ---
    const wasmStart = performance.now();
    const wasmResult = engine.findBestMoveWithParams(
      board,
      "white",
      MAX_DEPTH,
      TIME_LIMIT,
      MAX_NODES,
    );
    const wasmTime = performance.now() - wasmStart;

    const tsMove = formatMove(tsResult.position);
    const wasmMove = formatMove(wasmResult.position);

    results.push({
      moveNum,
      moveStr: expectedMoveStr,
      tsTimeMs: Math.round(tsTime),
      wasmTimeMs: Math.round(wasmTime),
      tsMove,
      wasmMove,
      tsScore: tsResult.score,
      wasmScore: wasmResult.score,
      tsDepth: tsResult.completedDepth,
      wasmDepth: wasmResult.completedDepth,
      moveMatch: tsMove === wasmMove,
    });

    // 進捗表示
    const ratio = wasmTime > 0 ? (tsTime / wasmTime).toFixed(1) : "N/A";
    console.log(
      `白${moveNum}手目 (棋譜:${expectedMoveStr}) | TS: ${Math.round(tsTime)}ms (d${tsResult.completedDepth}) → ${tsMove} | WASM: ${Math.round(wasmTime)}ms (d${wasmResult.completedDepth}) → ${wasmMove} | ${ratio}x ${tsMove === wasmMove ? "✓" : "✗"}`,
    );
  }

  // サマリ
  console.log();
  console.log("=== サマリ ===");
  console.log(
    "手番  | 棋譜手 | TS思考(ms) | TS深度 | TS手  | WASM思考(ms) | WASM深度 | WASM手 | 速度比  | 一致",
  );
  console.log(
    "------|--------|------------|--------|-------|--------------|----------|--------|---------|-----",
  );

  let totalTsTime = 0;
  let totalWasmTime = 0;
  let matchCount = 0;

  for (const r of results) {
    const ratio =
      r.wasmTimeMs > 0 ? (r.tsTimeMs / r.wasmTimeMs).toFixed(1) : "N/A";
    totalTsTime += r.tsTimeMs;
    totalWasmTime += r.wasmTimeMs;
    if (r.moveMatch) {
      matchCount++;
    }

    console.log(
      `白${String(r.moveNum).padStart(2)}  | ${r.moveStr.padEnd(6)} | ${String(r.tsTimeMs).padStart(10)} | ${String(r.tsDepth).padStart(6)} | ${r.tsMove.padEnd(5)} | ${String(r.wasmTimeMs).padStart(12)} | ${String(r.wasmDepth).padStart(8)} | ${r.wasmMove.padEnd(6)} | ${String(ratio).padStart(6)}x | ${r.moveMatch ? "✓" : "✗"}`,
    );
  }

  console.log();
  console.log(`合計 TS: ${totalTsTime}ms, WASM: ${totalWasmTime}ms`);
  const avgRatio =
    totalWasmTime > 0 ? (totalTsTime / totalWasmTime).toFixed(2) : "N/A";
  console.log(`平均速度比 (TS/WASM): ${avgRatio}x`);
  console.log(
    `手一致率: ${matchCount}/${results.length} (${((matchCount / results.length) * 100).toFixed(0)}%)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
