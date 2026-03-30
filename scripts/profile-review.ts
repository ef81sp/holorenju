#!/usr/bin/env node
/**
 * 振り返り分析の詳細プロファイリングツール
 *
 * 棋譜を引数で受け取り、review.worker.ts の handleFullEval 相当の処理を
 * メインスレッドで実行し、各フェーズの所要時間を計測する。
 *
 * 使用例:
 *   pnpm profile:review "H8 H9 J10 I9 ..." --perspective=white
 *   pnpm profile:review --kifu="H8 H9 J10 I9 ..." --perspective=black
 *   pnpm profile:review "H8 H9 ..." --precise --verbose --wasm
 */

import type { MoveScoreEntry } from "@/logic/cpu/search/results";
import type { WasmModuleContext } from "@/logic/cpu/wasm/types";
import type { ScoreBreakdown } from "@/types/cpu";
import type { Position } from "@/types/game";
import type { ReviewCandidate, ForcedLossType } from "@/types/review";

import { countStones } from "@/logic/cpu/core/boardUtils";
import {
  detectOpponentThreats,
  evaluatePositionWithBreakdown,
  evaluateBoardWithBreakdown,
  PATTERN_SCORES,
} from "@/logic/cpu/evaluation";
import { findMiseTargets } from "@/logic/cpu/evaluation/miseTactics";
import {
  verifyCandidates,
  findSafeBest,
} from "@/logic/cpu/review/candidateVerification";
import { evaluatePlayedForcedWin } from "@/logic/cpu/review/evaluatePlayedMove";
import {
  checkForcedLoss,
  REVIEW_VCF_OPTIONS,
  REVIEW_MISE_VCF_OPTIONS,
  FORCED_LOSS_VCT_OPTIONS,
} from "@/logic/cpu/review/forcedLossCheck";
import { detectForcedWin } from "@/logic/cpu/review/forcedWinDetection";
import { verifyCandidatePVs } from "@/logic/cpu/review/pvVerification";
import {
  REVIEW_PROFILE_FAST,
  REVIEW_PROFILE_PRECISE,
  REVIEW_REDUCED_NODES,
  REVIEW_SEARCH_PARAMS,
  REVIEW_VCT_OPTIONS_WITH_BRANCHES,
} from "@/logic/cpu/review/reviewConstants";
import { findBestMoveIterativeWithTT } from "@/logic/cpu/search/minimax";
import { findVCTSequence, VCT_STONE_THRESHOLD } from "@/logic/cpu/search/vct";
import { globalTT } from "@/logic/cpu/transpositionTable";
import {
  type BoardEvaluator,
  WasmBoardEvaluator,
} from "@/logic/cpu/wasm/bridge";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";

// ─── CLI 引数パース ─────────────────────────────────────

function parseArgs(): {
  kifu: string;
  perspective: "black" | "white";
  precise: boolean;
  verbose: boolean;
  useWasm: boolean;
} {
  const args = process.argv.slice(2);
  let kifu = "";
  let perspective: "black" | "white" = "white";
  let precise = false;
  let verbose = false;
  let useWasm = false;

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
    } else if (!arg.startsWith("--")) {
      kifu = arg;
    }
  }

  if (!kifu) {
    console.error(
      '使用法: pnpm profile:review "H8 H9 ..." [--perspective=white] [--precise] [--verbose] [--wasm]',
    );
    process.exit(1);
  }

  return { kifu, perspective, precise, verbose, useWasm };
}

const { kifu, perspective, precise, verbose, useWasm } = parseArgs();
const profile = precise ? REVIEW_PROFILE_PRECISE : REVIEW_PROFILE_FAST;

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

// ─── タイミング型定義 ──────────────────────────────────

interface SubPhaseDetail {
  name: string;
  time: number;
  extra?: string;
}

interface PhaseTimings {
  forcedWinDetection: number;
  forcedLossCheck: number;
  minimaxSearch: number;
  vctRetry: number;
  candidateVerification: number;
  pvVerification: number;
  total: number;
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
  timings: PhaseTimings;
  subPhases: SubPhaseDetail[];
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
): MoveProfile {
  const totalStart = performance.now();
  const timings: PhaseTimings = {
    forcedWinDetection: 0,
    forcedLossCheck: 0,
    minimaxSearch: 0,
    vctRetry: 0,
    candidateVerification: 0,
    pvVerification: 0,
    total: 0,
  };
  const subPhases: SubPhaseDetail[] = [];

  // TT クリア（高速モード時）
  if (profile.clearTT) {
    globalTT.clear();
  }

  // 盤面構築
  const { board, nextColor } = createBoardFromRecord(
    moves.slice(0, moveIndex).join(" "),
  );
  const color = nextColor as "black" | "white";
  const opponentColor = color === "black" ? "white" : "black";

  // 相手脅威チェック
  const opponentThreats = detectOpponentThreats(board, opponentColor);
  const opponentHasFour =
    opponentThreats.fours.length > 0 || opponentThreats.openFours.length > 0;

  // ─── Phase 1: 強制勝ち検出 ───
  let t0 = performance.now();
  const { forcedWin, forcedWinType, doubleMiseMoves, doubleMiseBestMove } =
    detectForcedWin(board, color, opponentHasFour, false);
  timings.forcedWinDetection = performance.now() - t0;
  subPhases.push({
    name: "強制勝ち検出",
    time: timings.forcedWinDetection,
    extra: forcedWinType ?? "なし",
  });

  let currentForcedWinType = forcedWinType;

  // ─── Phase 2: 強制負け検出 ───
  let forcedLossType: ForcedLossType | undefined = undefined;
  let needsVCTCheck = false;
  t0 = performance.now();
  if (moves[moveIndex]) {
    const { board: boardAfter } = createBoardFromRecord(
      moves.slice(0, moveIndex + 1).join(" "),
    );
    const stoneCountAfter = countStones(boardAfter);
    const selfThreatsAfter = detectOpponentThreats(boardAfter, color);
    const selfHasFourAfter =
      selfThreatsAfter.fours.length > 0 ||
      selfThreatsAfter.openFours.length > 0;

    if (!selfHasFourAfter) {
      const loss = checkForcedLoss(boardAfter, opponentColor, stoneCountAfter, {
        vcfOptions: REVIEW_VCF_OPTIONS,
        miseVcfOptions: REVIEW_MISE_VCF_OPTIONS,
        vctOptions: FORCED_LOSS_VCT_OPTIONS,
        skipVCT: true,
      });
      if (loss) {
        forcedLossType = loss.type;
      } else {
        needsVCTCheck = true;
      }
    }
  }
  timings.forcedLossCheck = performance.now() - t0;
  subPhases.push({
    name: "強制負け検出",
    time: timings.forcedLossCheck,
    extra: forcedLossType ?? (needsVCTCheck ? "VCT要確認" : "なし"),
  });

  // ─── Phase 3: Minimax探索 ───
  const hasForcedWin = Boolean(forcedWin || doubleMiseBestMove);
  const effectiveMaxNodes =
    profile.enablePVVerification && (forcedLossType || hasForcedWin)
      ? REVIEW_REDUCED_NODES
      : profile.maxNodes;

  t0 = performance.now();
  const result = findBestMoveIterativeWithTT({
    board,
    color,
    maxDepth: REVIEW_SEARCH_PARAMS.depth,
    randomFactor: 0,
    evaluationOptions: REVIEW_SEARCH_PARAMS.evaluationOptions,
    maxNodes: effectiveMaxNodes,
    timeLimit: profile.timeLimit,
    absoluteTimeLimit: profile.absoluteTimeLimit,
    aspirationWidths: profile.aspirationWidths,
    collectPV: true,
    boardEvaluator,
  });
  timings.minimaxSearch = performance.now() - t0;
  subPhases.push({
    name: "Minimax探索",
    time: timings.minimaxSearch,
    extra: `depth:${result.completedDepth} nodes:${effectiveMaxNodes} score:${result.score}`,
  });

  // ─── Phase 4: VCTリトライ ───
  let currentForcedWin = forcedWin;
  t0 = performance.now();
  if (
    !currentForcedWin &&
    !doubleMiseBestMove &&
    result.score >= PATTERN_SCORES.FIVE - 1 &&
    !opponentHasFour
  ) {
    const vctRetry = findVCTSequence(
      board,
      color,
      REVIEW_VCT_OPTIONS_WITH_BRANCHES,
    );
    if (vctRetry) {
      currentForcedWin = vctRetry;
      currentForcedWinType = vctRetry.isForbiddenTrap
        ? "forbidden-trap"
        : "vct";
    }
  }
  timings.vctRetry = performance.now() - t0;
  if (timings.vctRetry > 1) {
    subPhases.push({
      name: "VCTリトライ",
      time: timings.vctRetry,
      extra: currentForcedWin && !forcedWin ? "検出" : "スキップ/なし",
    });
  }

  // ─── 候補手リスト構築 ───
  const buildCandidate = (entry: MoveScoreEntry): ReviewCandidate => {
    const { score: breakdownScore, breakdown } = evaluatePositionWithBreakdown(
      board,
      entry.move.row,
      entry.move.col,
      color,
      REVIEW_SEARCH_PARAMS.evaluationOptions,
    );
    const leafEvaluation =
      entry.pvLeafBoard && entry.pvLeafColor
        ? evaluateBoardWithBreakdown(entry.pvLeafBoard, color)
        : undefined;
    return {
      position: entry.move,
      score: Math.round(breakdownScore),
      searchScore: entry.score,
      breakdown: breakdown as ScoreBreakdown,
      principalVariation: entry.pv,
      leafEvaluation,
    };
  };

  // 実際の手の座標を解析
  const playedMoveStr = moves[moveIndex];
  let playedRow = -1;
  let playedCol = -1;
  if (playedMoveStr) {
    playedCol = playedMoveStr.charCodeAt(0) - "A".charCodeAt(0);
    const playedRowNum = parseInt(playedMoveStr.slice(1), 10);
    playedRow = 15 - playedRowNum;
  }

  let candidates: ReviewCandidate[] = [];

  if (currentForcedWin) {
    // === forcedWin パス ===
    const bestScore = PATTERN_SCORES.FIVE;
    const bestMove = currentForcedWin.firstMove;

    const { score: fwBreakdownScore, breakdown: fwBreakdown } =
      evaluatePositionWithBreakdown(
        board,
        bestMove.row,
        bestMove.col,
        color,
        REVIEW_SEARCH_PARAMS.evaluationOptions,
      );

    let bestPV: Position[] = currentForcedWin.sequence;
    let doubleMiseTargets: Position[] | undefined = undefined;
    if (doubleMiseBestMove) {
      const dmRow = board[doubleMiseBestMove.row];
      if (dmRow) {
        dmRow[doubleMiseBestMove.col] = color;
        doubleMiseTargets = findMiseTargets(
          board,
          doubleMiseBestMove.row,
          doubleMiseBestMove.col,
          color,
        );
        dmRow[doubleMiseBestMove.col] = null;
      }
      if (
        currentForcedWinType === "double-mise" &&
        doubleMiseTargets &&
        doubleMiseTargets.length >= 2 &&
        doubleMiseTargets[0] &&
        doubleMiseTargets[1]
      ) {
        bestPV = [bestMove, doubleMiseTargets[0], doubleMiseTargets[1]];
      }
    }

    candidates = [];
    candidates.push({
      position: bestMove,
      score: Math.round(fwBreakdownScore),
      searchScore: PATTERN_SCORES.FIVE,
      breakdown: fwBreakdown as ScoreBreakdown,
      principalVariation: bestPV,
    });

    const minimaxCandidates = (result.candidates ?? [])
      .slice(0, 5)
      .filter(
        (e) => !(e.move.row === bestMove.row && e.move.col === bestMove.col),
      )
      .map(buildCandidate);
    candidates.push(...minimaxCandidates);

    // 実際の手の追い詰めシーケンスを反映
    if (playedRow >= 0) {
      const { playedForcedWinSequence } = evaluatePlayedForcedWin(
        board,
        color,
        playedRow,
        playedCol,
        bestMove,
        bestScore,
        result,
        countStones(board) < VCT_STONE_THRESHOLD,
        doubleMiseMoves,
      );
      if (playedForcedWinSequence) {
        const existingIdx = candidates.findIndex(
          (c) => c.position.row === playedRow && c.position.col === playedCol,
        );
        if (existingIdx >= 0 && candidates[existingIdx]) {
          candidates[existingIdx] = {
            ...candidates[existingIdx],
            principalVariation: playedForcedWinSequence,
            searchScore: PATTERN_SCORES.FIVE,
          };
        } else {
          const { score: pScore, breakdown: pBreakdown } =
            evaluatePositionWithBreakdown(
              board,
              playedRow,
              playedCol,
              color,
              REVIEW_SEARCH_PARAMS.evaluationOptions,
            );
          candidates.push({
            position: { row: playedRow, col: playedCol },
            score: Math.round(pScore),
            searchScore: PATTERN_SCORES.FIVE,
            breakdown: pBreakdown as ScoreBreakdown,
            principalVariation: playedForcedWinSequence,
          });
        }
      }
    }
  } else {
    // === 通常パス ===
    candidates = (result.candidates ?? []).slice(0, 5).map(buildCandidate);

    if (
      playedRow >= 0 &&
      !candidates.some(
        (c) => c.position.row === playedRow && c.position.col === playedCol,
      )
    ) {
      const playedEntry = (result.candidates ?? []).find(
        (c) => c.move.row === playedRow && c.move.col === playedCol,
      );
      if (playedEntry) {
        candidates.push(buildCandidate(playedEntry));
      }
    }
  }

  // ─── Phase 5: 候補手検証 ───
  const stoneCount = countStones(board);
  t0 = performance.now();
  const normalBudget =
    profile.verifyCandidatesBudget === "dynamic"
      ? Math.max(1000, Math.min(5000, 25_000 - (result.elapsedTime ?? 0)))
      : profile.verifyCandidatesBudget;
  const { demotedBest } = verifyCandidates(
    board,
    candidates,
    color,
    opponentColor,
    stoneCount,
    normalBudget,
  );
  timings.candidateVerification = performance.now() - t0;

  // 候補ごとの検証結果を記録
  const candDetails: string[] = [];
  for (const c of candidates) {
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

  // ─── Phase 6: PV検証 ───
  t0 = performance.now();
  if (profile.enablePVVerification) {
    verifyCandidatePVs(
      board,
      candidates,
      color,
      opponentColor,
      stoneCount,
      Infinity,
    );
  }
  timings.pvVerification = performance.now() - t0;
  if (timings.pvVerification > 1 || profile.enablePVVerification) {
    subPhases.push({
      name: "PV事後検証",
      time: timings.pvVerification,
      extra: profile.enablePVVerification ? "有効" : "無効",
    });
  }

  // 降格ハンドリング
  if (currentForcedWin) {
    if (demotedBest || candidates[0]?.opponentForcedWin) {
      const safeBest = findSafeBest(candidates);
      if (safeBest) {
        currentForcedWinType = undefined;
      }
    }
  } else {
    const bestDemoted =
      demotedBest || Boolean(candidates[0]?.opponentForcedWin);
    if (bestDemoted) {
      findSafeBest(candidates);
    }
  }

  // 打たれた手にforcedLossType反映
  if (forcedLossType && playedRow >= 0) {
    const playedCand = candidates.find(
      (c) => c.position.row === playedRow && c.position.col === playedCol,
    );
    if (playedCand && !playedCand.opponentForcedWin) {
      playedCand.opponentForcedWin = forcedLossType;
    }
  }

  timings.total = performance.now() - totalStart;

  return {
    moveIndex,
    moveStr: moves[moveIndex] ?? "?",
    color,
    bestMoveStr: formatMove(result.position),
    bestScore: result.score,
    completedDepth: result.completedDepth,
    forcedWinType: currentForcedWinType,
    forcedLossType,
    candidateCount: candidates.length,
    timings,
    subPhases,
  };
}

// ─── メイン実行 ──────────────────────────────────────

async function main(): Promise<void> {
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
  if (useWasm && boardEvaluator) {
    console.log("WASM evaluator loaded");
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
  const totals: PhaseTimings = {
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

    const p = profileMove(moves, idx, boardEvaluator);
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
