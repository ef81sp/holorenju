#!/usr/bin/env node
/**
 * Gate 3（実用チェック）: 振り返り解析の legacy vs prospect 基底比較
 *
 * docs/plans/eval-basis-prospect-2026-07-13.md §5 Gate 3 用の一回限りの計測スクリプト。
 * REVIEW_SEARCH_PARAMS.evaluationOptions（= DIFFICULTY_PARAMS.hard.evaluationOptions）は
 * P5-a で evalBasis: "prospect" に切り替わっているため、legacy 側は evalOptionsOverride で
 * 明示的に evalBasis: "legacy" のフラグへ差し替えて実行する。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/gate3-review-compare.ts
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/gate3-review-compare.ts --kifu="H8 G8 ..." --json=bench-results/gate3.json
 */

import { writeFileSync } from "node:fs";

import { executeFullEval } from "@/logic/cpu/review/fullEval";
import { REVIEW_PROFILE_FAST } from "@/logic/cpu/review/reviewConstants";
import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import {
  encodeEvalOptions,
  WasmSearchEngine,
} from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import { formatMove } from "@/logic/gameRecordParser";
import {
  buildEvaluatedMove,
  buildGameReview,
  type MoveQuality,
} from "@/logic/reviewLogic";
import { DIFFICULTY_PARAMS } from "@/types/cpu";

/** 10秒予算確認のために内訳を記録する代表局面（序盤・中盤・終盤） */
const REPRESENTATIVE_INDICES = [5, 14, 24];

const DEFAULT_KIFU =
  "H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12";

function parseArgs(): { kifu: string; jsonOut: string | undefined } {
  const args = process.argv.slice(2);
  let kifu = DEFAULT_KIFU;
  let jsonOut: string | undefined = undefined;
  for (const arg of args) {
    if (arg.startsWith("--kifu=")) {
      kifu = arg.slice("--kifu=".length);
    } else if (arg.startsWith("--json=")) {
      jsonOut = arg.slice("--json=".length);
    }
  }
  return { kifu, jsonOut };
}

const { kifu, jsonOut } = parseArgs();

type Basis = "legacy" | "prospect";

interface MoveRecord {
  moveIndex: number;
  moveStr: string;
  color: "black" | "white";
  bestMoveStr: string;
  bestScore: number;
  playedScore: number;
  scoreDiff: number;
  quality: MoveQuality;
  completedDepth: number | undefined;
  forcedLossType: string | undefined;
  totalMs: number;
  minimaxMs: number;
  forcedWinMs: number;
  forcedLossMs: number;
  vctRetryMs: number;
  candidateVerificationMs: number;
}

interface BasisRun {
  basis: Basis;
  moves: MoveRecord[];
  accuracy: number;
  criticalErrors: number;
  losingMoveIndex: number | undefined;
  totalElapsedMs: number;
  avgDepth: number;
  maxDepth: number;
  minDepth: number;
}

function runBasis(
  basis: Basis,
  moves: string[],
  wasmEngine: WasmSearchEngine,
): BasisRun {
  const flags = encodeEvalOptions({
    ...DIFFICULTY_PARAMS.hard.evaluationOptions,
    evalBasis: basis,
  });
  // profile-review.ts と同じ手法: REVIEW_PROFILE_FAST.evalOptionsOverride を
  // 実行時に書き換えて executeFullEval に basis を伝搬する。
  (
    REVIEW_PROFILE_FAST as { evalOptionsOverride: number | undefined }
  ).evalOptionsOverride = flags;

  const records: MoveRecord[] = [];
  const evaluatedMoves = [];
  let totalElapsedMs = 0;

  for (let idx = 0; idx < moves.length; idx++) {
    const moveHistory = moves.join(" ");
    const result = executeFullEval({
      moveHistory,
      moveIndex: idx,
      preciseAnalysis: false,
      wasmSearchEngine: wasmEngine,
    });
    totalElapsedMs += result.timings.total;

    const resultForEval = {
      ...result,
      candidates: result.candidates.map((c) => ({ ...c })),
    };
    const evaluated = buildEvaluatedMove(
      resultForEval,
      moveHistory,
      true,
      true,
    );
    evaluatedMoves.push(evaluated);

    records.push({
      moveIndex: idx,
      moveStr: moves[idx] ?? "?",
      color: idx % 2 === 0 ? "black" : "white",
      bestMoveStr: formatMove(result.bestMove),
      bestScore: evaluated.bestScore,
      playedScore: evaluated.playedScore,
      scoreDiff: evaluated.scoreDiff,
      quality: evaluated.quality,
      completedDepth: result.completedDepth,
      forcedLossType: result.forcedLossType,
      totalMs: result.timings.total,
      minimaxMs: result.timings.minimaxSearch,
      forcedWinMs: result.timings.forcedWinDetection,
      forcedLossMs: result.timings.forcedLossCheck,
      vctRetryMs: result.timings.vctRetry,
      candidateVerificationMs: result.timings.candidateVerification,
    });

    process.stdout.write(
      `  [${basis}] 手${idx + 1} ${moves[idx]}: ${evaluated.quality.padEnd(10)} scoreDiff=${String(evaluated.scoreDiff).padStart(6)} depth=${String(result.completedDepth).padStart(2)} ${Math.round(result.timings.total)}ms\n`,
    );
  }

  const review = buildGameReview(evaluatedMoves);
  const depths = records
    .map((r) => r.completedDepth)
    .filter((d): d is number => d !== undefined);

  return {
    basis,
    moves: records,
    accuracy: review.accuracy,
    criticalErrors: review.criticalErrors,
    losingMoveIndex: review.losingMove?.moveIndex,
    totalElapsedMs,
    avgDepth: depths.reduce((a, b) => a + b, 0) / (depths.length || 1),
    maxDepth: Math.max(...depths),
    minDepth: Math.min(...depths),
  };
}

async function main(): Promise<void> {
  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const wasm = await loadWasmModule();
  const wasmEngine = new WasmSearchEngine(wasm);

  const moves = kifu.trim().split(/\s+/);
  console.log("=== Gate 3: 振り返り解析 legacy vs prospect 比較 ===");
  console.log(`棋譜: ${kifu}`);
  console.log(`手数: ${moves.length}`);
  console.log("");

  console.log("--- legacy ---");
  const legacy = runBasis("legacy", moves, wasmEngine);
  console.log("");
  console.log("--- prospect ---");
  const prospect = runBasis("prospect", moves, wasmEngine);

  console.log("");
  console.log("=== サマリー ===");
  for (const run of [legacy, prospect]) {
    console.log(
      `[${run.basis}] accuracy=${run.accuracy}% criticalErrors=${run.criticalErrors} losingMove=${run.losingMoveIndex === undefined ? "なし" : `手${run.losingMoveIndex + 1}`} totalElapsed=${Math.round(run.totalElapsedMs)}ms avgDepth=${run.avgDepth.toFixed(2)} depth[min-max]=${run.minDepth}-${run.maxDepth}`,
    );
  }

  console.log("");
  console.log(
    "=== 手ごとの差分（quality または scoreDiff が異なる手のみ） ===",
  );
  for (let i = 0; i < moves.length; i++) {
    const l = legacy.moves[i]!;
    const p = prospect.moves[i]!;
    if (l.quality !== p.quality || Math.abs(l.scoreDiff - p.scoreDiff) > 50) {
      console.log(
        `  手${i + 1} ${l.moveStr}(${l.color}): legacy=${l.quality}/${l.scoreDiff} vs prospect=${p.quality}/${p.scoreDiff} (best legacy=${l.bestMoveStr}/${l.bestScore}, prospect=${p.bestMoveStr}/${p.bestScore})`,
      );
    }
  }

  console.log("");
  console.log(
    "=== 10秒予算内の深度確認（代表局面: 序盤/中盤/終盤・timeLimit=5000ms/absoluteTimeLimit=10000ms） ===",
  );
  for (const idx of REPRESENTATIVE_INDICES) {
    const l = legacy.moves[idx];
    const p = prospect.moves[idx];
    if (!l || !p) {
      continue;
    }
    console.log(`  手${idx + 1} ${l.moveStr}(${l.color}):`);
    console.log(
      `    legacy:   depth=${l.completedDepth} minimax=${Math.round(l.minimaxMs)}ms total=${Math.round(l.totalMs)}ms (fw=${Math.round(l.forcedWinMs)} fl=${Math.round(l.forcedLossMs)} vct=${Math.round(l.vctRetryMs)} cand=${Math.round(l.candidateVerificationMs)})`,
    );
    console.log(
      `    prospect: depth=${p.completedDepth} minimax=${Math.round(p.minimaxMs)}ms total=${Math.round(p.totalMs)}ms (fw=${Math.round(p.forcedWinMs)} fl=${Math.round(p.forcedLossMs)} vct=${Math.round(p.vctRetryMs)} cand=${Math.round(p.candidateVerificationMs)})`,
    );
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ kifu, legacy, prospect }, null, 2));
    console.log("");
    console.log(`結果を書き出し: ${jsonOut}`);
  }
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
