#!/usr/bin/env node
/**
 * 振り返り分析の詳細プロファイリングツール
 *
 * 棋譜を引数で受け取り、executeFullEval を使って各フェーズの所要時間を計測する。
 *
 * 使用例:
 *   pnpm profile:review "H8 H9 J10 I9 ..." --perspective=white
 *   pnpm profile:review --kifu="H8 H9 J10 I9 ..." --perspective=black
 *   pnpm profile:review "H8 H9 ..." --precise --verbose --wasm
 */

import type { WasmModuleContext } from "@/logic/cpu/wasm/types";

import {
  executeFullEval,
  type FullEvalTimings,
} from "@/logic/cpu/review/fullEval";
import {
  REVIEW_PROFILE_FAST,
  REVIEW_PROFILE_PRECISE,
  REVIEW_SEARCH_PARAMS,
} from "@/logic/cpu/review/reviewConstants";
import {
  type BoardEvaluator,
  WasmBoardEvaluator,
} from "@/logic/cpu/wasm/bridge";
import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import { formatMove } from "@/logic/gameRecordParser";
import { buildEvaluatedMove } from "@/logic/reviewLogic";

// ─── CLI 引数パース ─────────────────────────────────────

function parseArgs(): {
  kifu: string;
  perspective: "black" | "white";
  precise: boolean;
  verbose: boolean;
  useWasm: boolean;
  timeLimitOverride: number | undefined;
  maxNodesOverride: number | undefined;
  depthOverride: number | undefined;
  evalMode: "hard" | "none" | undefined;
} {
  const args = process.argv.slice(2);
  let kifu = "";
  let perspective: "black" | "white" = "white";
  let precise = false;
  let verbose = false;
  let useWasm = false;
  let timeLimitOverride: number | undefined = undefined;
  let maxNodesOverride: number | undefined = undefined;
  let depthOverride: number | undefined = undefined;
  let evalMode: "hard" | "none" | undefined = undefined;

  for (const arg of args) {
    if (arg.startsWith("--kifu=")) {
      kifu = arg.slice("--kifu=".length);
    } else if (arg.startsWith("--perspective=")) {
      const val = arg.slice("--perspective=".length);
      if (val === "black" || val === "white") {
        perspective = val;
      }
    } else if (arg === "--precise") {
      precise = true;
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--wasm") {
      useWasm = true;
    } else if (arg.startsWith("--time-limit=")) {
      const val = parseInt(arg.slice("--time-limit=".length), 10);
      if (!isNaN(val)) {
        timeLimitOverride = val;
      }
    } else if (arg.startsWith("--max-nodes=")) {
      const val = parseInt(arg.slice("--max-nodes=".length), 10);
      if (!isNaN(val)) {
        maxNodesOverride = val;
      }
    } else if (arg.startsWith("--depth=")) {
      const val = parseInt(arg.slice("--depth=".length), 10);
      if (!isNaN(val)) {
        depthOverride = val;
      }
    } else if (arg.startsWith("--eval=")) {
      const val = arg.slice("--eval=".length);
      if (val === "hard" || val === "none") {
        evalMode = val;
      }
    } else if (!arg.startsWith("--")) {
      kifu = arg;
    }
  }

  if (!kifu) {
    console.error(
      '使用法: pnpm profile:review "H8 H9 ..." [--perspective=white] [--precise] [--verbose] [--wasm] [--time-limit=N] [--max-nodes=N] [--depth=N] [--eval=hard|none]',
    );
    process.exit(1);
  }

  return {
    kifu,
    perspective,
    precise,
    verbose,
    useWasm,
    timeLimitOverride,
    maxNodesOverride,
    depthOverride,
    evalMode,
  };
}

const {
  kifu,
  perspective,
  precise,
  verbose,
  useWasm,
  timeLimitOverride,
  maxNodesOverride,
  depthOverride,
  evalMode,
} = parseArgs();

// ─── WASM 初期化 ─────────────────────────────────────

let cachedWasm: WasmModuleContext | null = null;

async function getWasmEvaluator(): Promise<BoardEvaluator | undefined> {
  if (!useWasm) {
    return undefined;
  }
  if (!cachedWasm) {
    try {
      cachedWasm = await loadWasmModule();
    } catch {
      console.warn("WASM module unavailable, falling back to TS");
      return undefined;
    }
  }
  return new WasmBoardEvaluator(cachedWasm);
}

async function getWasmSearchEngine(): Promise<WasmSearchEngine | undefined> {
  if (!useWasm) {
    return undefined;
  }
  if (!cachedWasm) {
    try {
      cachedWasm = await loadWasmModule();
    } catch {
      return undefined;
    }
  }
  return new WasmSearchEngine(cachedWasm);
}

// ─── タイミング型定義（プロファイル出力用） ──────────────────

interface SubPhaseDetail {
  name: string;
  time: number;
  extra?: string;
}

interface MoveProfile {
  moveIndex: number;
  moveStr: string;
  color: "black" | "white";
  bestMoveStr: string;
  bestScore: number;
  completedDepth: number;
  forcedWinType: string | undefined;
  forcedLossType: string | undefined;
  candidateCount: number;
  timings: FullEvalTimings;
  subPhases: SubPhaseDetail[];
  playedScore: number;
  scoreDiff: number;
  quality: string;
}

// ─── ログ出力ヘルパー ──────────────────────────────────

function fmtMs(ms: number): string {
  return `${Math.round(ms)}ms`;
}

function fmtPct(part: number, total: number): string {
  if (total <= 0) {
    return "0.0%";
  }
  return `${((part / total) * 100).toFixed(1)}%`;
}

// ─── 1手分析 ──────────────────────────────────────────

function profileMove(
  moves: string[],
  moveIndex: number,
  boardEvaluator: BoardEvaluator | undefined,
  wasmEngine: WasmSearchEngine | undefined,
): MoveProfile {
  const moveHistory = moves.join(" ");

  const result = executeFullEval({
    moveHistory,
    moveIndex,
    preciseAnalysis: precise,
    boardEvaluator,
    wasmSearchEngine: wasmEngine,
  });

  const { timings } = result;
  const color = moveIndex % 2 === 0 ? ("black" as const) : ("white" as const);

  // サブフェーズ詳細を構築
  const subPhases: SubPhaseDetail[] = [];
  subPhases.push({
    name: "強制勝ち検出",
    time: timings.forcedWinDetection,
    extra: result.forcedWinType ?? "なし",
  });
  subPhases.push({
    name: "強制負け検出",
    time: timings.forcedLossCheck,
    extra:
      result.forcedLossType ?? (result.needsVCTCheck ? "VCT要確認" : "なし"),
  });
  subPhases.push({
    name: "Minimax探索",
    time: timings.minimaxSearch,
    extra: `depth:${result.completedDepth} score:${result.bestScore}`,
  });
  if (timings.vctRetry > 1) {
    subPhases.push({
      name: "VCTリトライ",
      time: timings.vctRetry,
      extra: result.forcedWinType ? "検出" : "スキップ/なし",
    });
  }

  // 候補ごとの検証結果を記録（buildEvaluatedMove より前に行う）
  const candDetails: string[] = [];
  for (const c of result.candidates) {
    const pos = formatMove(c.position);
    const status = c.opponentForcedWin
      ? `forced_loss:${c.opponentForcedWin}`
      : "safe";
    candDetails.push(`${pos}[${status}]`);
  }
  subPhases.push({
    name: "候補手検証",
    time: timings.candidateVerification,
    extra: candDetails.join(" "),
  });

  if (timings.pvVerification > 1 || precise) {
    subPhases.push({
      name: "PV事後検証",
      time: timings.pvVerification,
      extra: precise ? "有効" : "無効",
    });
  }

  // candidates を浅いコピーして渡す（buildEvaluatedMove は破壊的ソートをする可能性がある）
  const resultForEval = {
    ...result,
    candidates: result.candidates.map((c) => ({ ...c })),
  };
  const evaluatedMove = buildEvaluatedMove(
    resultForEval,
    moveHistory,
    true,
    true,
  );

  return {
    moveIndex,
    moveStr: moves[moveIndex] ?? "?",
    color,
    bestMoveStr: formatMove(result.bestMove),
    bestScore: result.bestScore,
    completedDepth: result.completedDepth,
    forcedWinType: result.forcedWinType,
    forcedLossType: result.forcedLossType,
    candidateCount: result.candidates.length,
    timings,
    subPhases,
    playedScore: evaluatedMove.playedScore,
    scoreDiff: evaluatedMove.scoreDiff,
    quality: evaluatedMove.quality,
  };
}

// ─── メイン実行 ──────────────────────────────────────

async function main(): Promise<void> {
  // CLI オーバーライド適用（as const オブジェクトのプロパティを実行時に書き換え）
  const activeProfile = precise
    ? (REVIEW_PROFILE_PRECISE as {
        timeLimit?: number;
        maxNodes?: number;
        evalOptionsOverride?: number;
      })
    : (REVIEW_PROFILE_FAST as {
        timeLimit?: number;
        maxNodes?: number;
        evalOptionsOverride?: number;
      });
  const searchParams = REVIEW_SEARCH_PARAMS as { depth: number };

  const overrideParts: string[] = [];
  if (timeLimitOverride !== undefined) {
    activeProfile.timeLimit = timeLimitOverride;
    overrideParts.push(`timeLimit=${timeLimitOverride}`);
  }
  if (maxNodesOverride !== undefined) {
    activeProfile.maxNodes = maxNodesOverride;
    overrideParts.push(`maxNodes=${maxNodesOverride}`);
  }
  if (depthOverride !== undefined) {
    searchParams.depth = depthOverride;
    overrideParts.push(`depth=${depthOverride}`);
  }
  if (evalMode === "none") {
    activeProfile.evalOptionsOverride = 0;
    overrideParts.push("eval=none");
  } else if (evalMode === "hard") {
    activeProfile.evalOptionsOverride = undefined;
    overrideParts.push("eval=hard");
  }
  if (overrideParts.length > 0) {
    console.log(`Override: ${overrideParts.join(", ")}`);
  }

  // #43 PR-6: 判定アダプタは pure-wasm 化済み。fullEval が使う threat/forbidden thin wasm を先にロード。
  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);

  const moves = kifu.trim().split(/\s+/);

  console.log("=== 振り返り分析プロファイリング ===");
  console.log(
    `モード: ${precise ? "精密" : "高速"}${useWasm ? " + WASM" : ""}`,
  );
  console.log(`棋譜: ${kifu}`);
  console.log(`手数: ${moves.length}`);
  console.log(`分析対象: ${perspective === "white" ? "白番" : "黒番"}`);
  console.log("");

  // WASM初期化
  const boardEvaluator = await getWasmEvaluator();
  const wasmEngine = await getWasmSearchEngine();
  if (useWasm && wasmEngine) {
    console.log("WASM search engine loaded");
  } else if (useWasm && boardEvaluator) {
    console.log("WASM evaluator only (search engine unavailable)");
  } else if (useWasm) {
    console.log("WASM unavailable, using TS fallback");
  }

  // 対象手のインデックスを収集
  // perspective=white → 偶数手目(index 1,3,5,...), perspective=black → 奇数手目(index 0,2,4,...)
  const targetIndices: number[] = [];
  const startIdx = perspective === "white" ? 1 : 0;
  for (let i = startIdx; i < moves.length; i += 2) {
    targetIndices.push(i);
  }

  const profiles: MoveProfile[] = [];
  const totals: FullEvalTimings = {
    forcedWinDetection: 0,
    forcedLossCheck: 0,
    minimaxSearch: 0,
    vctRetry: 0,
    candidateVerification: 0,
    pvVerification: 0,
    total: 0,
  };

  for (const idx of targetIndices) {
    const moveNum = idx + 1;
    const moveStr = moves[idx] ?? "?";
    process.stdout.write(
      `\n=== 手${moveNum} (${perspective === "white" ? "白" : "黒"} ${moveStr}) ===\n`,
    );

    const p = profileMove(moves, idx, boardEvaluator, wasmEngine);
    profiles.push(p);

    // 詳細フェーズ出力
    for (const sp of p.subPhases) {
      const timeStr = fmtMs(sp.time).padStart(8);
      let marker = "";
      if (sp.time > 5000) {
        marker = " << SLOW";
      } else if (sp.time > 1000) {
        marker = " < slow";
      }
      console.log(`  [${sp.name}] ${timeStr}${marker}`);
      if (verbose && sp.extra) {
        console.log(`    ${sp.extra}`);
      }
    }
    console.log(`  合計: ${fmtMs(p.timings.total)}`);

    totals.forcedWinDetection += p.timings.forcedWinDetection;
    totals.forcedLossCheck += p.timings.forcedLossCheck;
    totals.minimaxSearch += p.timings.minimaxSearch;
    totals.vctRetry += p.timings.vctRetry;
    totals.candidateVerification += p.timings.candidateVerification;
    totals.pvVerification += p.timings.pvVerification;
    totals.total += p.timings.total;
  }

  // ─── サマリー ──────────────────────────────────────

  console.log("");
  console.log("=== サマリー ===");
  console.log(
    `全${targetIndices.length}手（${perspective === "white" ? "白番" : "黒番"}）分析完了: 合計 ${fmtMs(totals.total)}`,
  );
  console.log("");

  // フェーズ別
  console.log("フェーズ別:");
  const phases = [
    { name: "強制勝ち検出", time: totals.forcedWinDetection },
    { name: "強制負け検出", time: totals.forcedLossCheck },
    { name: "Minimax探索", time: totals.minimaxSearch },
    { name: "VCTリトライ", time: totals.vctRetry },
    { name: "候補手検証", time: totals.candidateVerification },
    { name: "PV事後検証", time: totals.pvVerification },
  ];

  for (const phase of phases) {
    console.log(
      `  ${phase.name.padEnd(20)} ${String(Math.round(phase.time)).padStart(8)}ms  (${fmtPct(phase.time, totals.total).padStart(6)})`,
    );
  }
  console.log(
    `  ${"合計".padEnd(20)} ${String(Math.round(totals.total)).padStart(8)}ms`,
  );

  // 最も遅い手 TOP 3
  console.log("");
  console.log("最も遅い手 TOP 3:");
  const slowest = [...profiles].sort(
    (a, b) => b.timings.total - a.timings.total,
  );
  for (let i = 0; i < Math.min(3, slowest.length); i++) {
    const s = slowest[i]!;
    const t = s.timings;
    const details = [
      `minimax:${fmtMs(t.minimaxSearch)}`,
      `勝検出:${fmtMs(t.forcedWinDetection)}`,
      `敗検出:${fmtMs(t.forcedLossCheck)}`,
      `候補検証:${fmtMs(t.candidateVerification)}`,
    ];
    if (t.pvVerification > 1) {
      details.push(`PV検証:${fmtMs(t.pvVerification)}`);
    }
    if (t.vctRetry > 1) {
      details.push(`VCTリ:${fmtMs(t.vctRetry)}`);
    }
    console.log(
      `  手${s.moveIndex + 1} (${s.moveStr}): ${fmtMs(s.timings.total)}`,
    );
    console.log(`    ${details.join(" ")}`);
  }

  // ボトルネック
  console.log("");
  const sorted = [...phases].sort((a, b) => b.time - a.time);
  const [top] = sorted;
  if (top && totals.total > 0) {
    console.log(
      `ボトルネック: ${top.name}が${fmtPct(top.time, totals.total)}を占める`,
    );
  }

  // 詳細テーブル（verbose時）
  if (verbose) {
    console.log("");
    console.log("=== 全手一覧 ===");
    console.log("");

    const header = [
      "手番".padEnd(6),
      "実手".padEnd(5),
      "最善手".padEnd(6),
      "スコア".padEnd(8),
      "深度".padEnd(4),
      "合計(ms)".padStart(10),
      "勝検出".padStart(10),
      "敗検出".padStart(10),
      "minimax".padStart(10),
      "候補検証".padStart(10),
      "PV検証".padStart(10),
      "勝ち筋",
      "負け筋",
      "quality".padEnd(11),
      "実手score".padStart(10),
      "scoreDiff".padStart(10),
    ].join(" | ");
    console.log(header);
    console.log("-".repeat(header.length));

    for (const p of profiles) {
      const t = p.timings;
      const prefix = p.color === "white" ? "白" : "黒";
      const row = [
        `${prefix}${p.moveIndex + 1}`.padEnd(6),
        p.moveStr.padEnd(5),
        p.bestMoveStr.padEnd(6),
        String(p.bestScore).padStart(8),
        String(p.completedDepth).padStart(4),
        String(Math.round(t.total)).padStart(10),
        String(Math.round(t.forcedWinDetection)).padStart(10),
        String(Math.round(t.forcedLossCheck)).padStart(10),
        String(Math.round(t.minimaxSearch)).padStart(10),
        String(Math.round(t.candidateVerification)).padStart(10),
        String(Math.round(t.pvVerification)).padStart(10),
        (p.forcedWinType ?? "-").padEnd(6),
        (p.forcedLossType ?? "-").padEnd(6),
        p.quality.padEnd(11),
        String(p.playedScore).padStart(10),
        String(p.scoreDiff).padStart(10),
      ].join(" | ");
      console.log(row);
    }
  }

  // WASM化効果予測
  if (!useWasm) {
    console.log("");
    console.log("=== WASM化効果予測 ===");

    const cpuTime =
      totals.forcedWinDetection +
      totals.forcedLossCheck +
      totals.minimaxSearch +
      totals.vctRetry +
      totals.candidateVerification +
      totals.pvVerification;
    const overhead = totals.total - cpuTime;

    for (const factor of [2, 3, 5]) {
      const estimated = Math.round(cpuTime / factor + overhead);
      const reduction = ((1 - estimated / totals.total) * 100).toFixed(0);
      console.log(
        `  ${factor}x高速化: ${fmtMs(totals.total)} -> ${fmtMs(estimated)} (${reduction}%削減)`,
      );
    }
  }
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
