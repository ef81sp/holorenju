/**
 * fullEval ロジック（振り返り評価のメイン処理）
 *
 * review.worker.ts と scripts/profile-review.ts の両方から呼ばれる SSoT。
 * vctCheckOnly / lightEval は Worker 側に残す（シンプルなため抽出不要）。
 */

import type { ScoreBreakdown } from "@/types/cpu";
import type { BoardState, Position } from "@/types/game";
import type {
  ForcedLossType,
  ForcedWinBranch,
  ForcedWinType,
  FullEvalResult,
  ReviewCandidate,
} from "@/types/review";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import type { MoveScoreEntry } from "../search/results";
import type { BoardEvaluator } from "../wasm/bridge";
import type { WasmSearchEngine } from "../wasm/searchEngine";

import { countStones } from "../core/boardUtils";
import {
  detectOpponentThreats,
  evaluatePositionWithBreakdown,
  evaluateBoardWithBreakdown,
  PATTERN_SCORES,
} from "../evaluation";
import { findMiseTargets } from "../evaluation/miseTactics";
import { findBestMoveIterativeWithTT } from "../search/minimax";
import { findVCFSequence, type VCFSequenceResult } from "../search/vcf";
import {
  findVCTSequence,
  VCT_STONE_THRESHOLD,
  type VCTBranch,
} from "../search/vct";
import { globalTT } from "../transpositionTable";
import { verifyCandidates, findSafeBest } from "./candidateVerification";
import { buildDoubleMiseBranches } from "./doubleMiseBranches";
import { evaluatePlayedForcedWin } from "./evaluatePlayedMove";
import {
  checkForcedLoss,
  FORCED_LOSS_VCT_OPTIONS,
  REVIEW_MISE_VCF_OPTIONS,
  REVIEW_VCF_OPTIONS,
} from "./forcedLossCheck";
import { detectForcedWin, type ForcedWinInfo } from "./forcedWinDetection";
import { verifyCandidatePVs } from "./pvVerification";
import {
  REVIEW_PROFILE_FAST,
  REVIEW_PROFILE_PRECISE,
  REVIEW_REDUCED_NODES,
  REVIEW_SEARCH_PARAMS,
  REVIEW_VCT_OPTIONS_WITH_BRANCHES,
} from "./reviewConstants";

// ─── WASM探索アダプター ──────────────────────────────────

type ReviewProfile = typeof REVIEW_PROFILE_FAST;

/**
 * WASM 探索エンジンで minimax 探索を実行し、TS 版と同じ結果型に変換する
 */
function executeWasmSearch(
  engine: WasmSearchEngine,
  board: BoardState,
  color: "black" | "white",
  maxNodes: number,
  profile: ReviewProfile,
): ReturnType<typeof findBestMoveIterativeWithTT> {
  const aspirationMode = profile.aspirationWidths ? 1 : 0;
  const wasmResult = engine.findBestMoveForReview(
    board,
    color,
    REVIEW_SEARCH_PARAMS.depth,
    profile.timeLimit ?? 0,
    maxNodes,
    profile.absoluteTimeLimit ?? 0,
    aspirationMode,
  );

  // WASM 候補手を MoveScoreEntry[] に変換
  const candidates: MoveScoreEntry[] = wasmResult.candidates.map((c) => ({
    move: c.position,
    score: c.score,
    pv: c.pv,
  }));

  return {
    position: wasmResult.position,
    score: wasmResult.score,
    completedDepth: wasmResult.completedDepth,
    interrupted: false,
    elapsedTime: 0,
    candidates,
    stats: {
      nodes: 0,
      ttHits: 0,
      ttCutoffs: 0,
      betaCutoffs: 0,
      forbiddenCheckCalls: 0,
      boardCopies: 0,
      threatDetectionCalls: 0,
      evaluationCalls: 0,
      nullMoveTrials: 0,
      nullMoveCutoffs: 0,
      futilityPrunes: 0,
      threatExtensions: 0,
      lmrTrials: 0,
      lmrResearches: 0,
      lmrMoveIndexDist: [0, 0, 0],
      qSearchNodes: 0,
      qSearchBranchSum: 0,
      qSearchEntries: 0,
      qSearchDepthSum: 0,
      qSearchLeaves: 0,
    },
  };
}

// ─── 型定義 ──────────────────────────────────────────

export interface FullEvalParams {
  /** 棋譜文字列（スペース区切り） */
  moveHistory: string;
  /** 評価する手のインデックス */
  moveIndex: number;
  /** 精密モードを使用するか */
  preciseAnalysis?: boolean;
  /** WASM 評価器（任意） */
  boardEvaluator?: BoardEvaluator;
  /** WASM 探索エンジン（任意、指定時は minimax 探索を WASM に委譲） */
  wasmSearchEngine?: WasmSearchEngine;
}

/** 各フェーズの所要時間 */
export interface FullEvalTimings {
  forcedWinDetection: number;
  forcedLossCheck: number;
  minimaxSearch: number;
  vctRetry: number;
  candidateVerification: number;
  pvVerification: number;
  total: number;
}

export interface FullEvalResultWithTimings extends FullEvalResult {
  timings: FullEvalTimings;
}

// ─── ヘルパー ─────────────────────────────────────────

/** VCF初手を候補リストの先頭に追加/更新する */
function promoteVcfCandidate(
  board: BoardState,
  candidates: ReviewCandidate[],
  reVcf: VCFSequenceResult,
  color: "black" | "white",
): void {
  const vcfIdx = candidates.findIndex(
    (c) =>
      c.position.row === reVcf.firstMove.row &&
      c.position.col === reVcf.firstMove.col,
  );
  if (vcfIdx >= 0) {
    const [entry] = candidates.splice(vcfIdx, 1);
    if (entry) {
      entry.searchScore = PATTERN_SCORES.FIVE;
      entry.principalVariation = reVcf.sequence;
      candidates.unshift(entry);
      return;
    }
  }
  const { score, breakdown } = evaluatePositionWithBreakdown(
    board,
    reVcf.firstMove.row,
    reVcf.firstMove.col,
    color,
    REVIEW_SEARCH_PARAMS.evaluationOptions,
  );
  candidates.unshift({
    position: reVcf.firstMove,
    score: Math.round(score),
    searchScore: PATTERN_SCORES.FIVE,
    breakdown: breakdown as ScoreBreakdown,
    principalVariation: reVcf.sequence,
  });
}

interface DemotionContext {
  board: BoardState;
  candidates: ReviewCandidate[];
  color: "black" | "white";
  forcedWinType: ForcedWinType | undefined;
  bestMove: Position;
  bestScore: number;
  fwBestLoss?: { type: ForcedLossType; sequence: Position[] };
}

/** 降格時のVCF再探索とフォールバック処理 */
function handleDemotion(ctx: DemotionContext): {
  forcedWinType: ForcedWinType | undefined;
  finalBestMove: Position;
  finalBestScore: number;
  forcedWinBranches: ForcedWinBranch[] | undefined;
  fwForcedLossType?: ForcedLossType;
  fwForcedLossSequence?: Position[];
  clearDoubleMise: boolean;
} {
  const safeBest = findSafeBest(ctx.candidates);
  if (!safeBest) {
    return {
      forcedWinType: ctx.forcedWinType,
      finalBestMove: ctx.bestMove,
      finalBestScore: ctx.bestScore,
      forcedWinBranches: undefined,
      fwForcedLossType: ctx.fwBestLoss?.type,
      fwForcedLossSequence: ctx.fwBestLoss?.sequence,
      clearDoubleMise: false,
    };
  }

  // 両ミセ降格時: maxDepth制限されていたVCFのフル再探索
  const reVcf =
    ctx.forcedWinType === "double-mise"
      ? findVCFSequence(ctx.board, ctx.color, REVIEW_VCF_OPTIONS)
      : null;

  if (reVcf) {
    promoteVcfCandidate(ctx.board, ctx.candidates, reVcf, ctx.color);
    return {
      forcedWinType: "vcf",
      finalBestMove: reVcf.firstMove,
      finalBestScore: PATTERN_SCORES.FIVE,
      forcedWinBranches: undefined,
      clearDoubleMise: true,
    };
  }

  return {
    forcedWinType: undefined,
    finalBestMove: safeBest.position,
    finalBestScore: safeBest.searchScore,
    forcedWinBranches: undefined,
    clearDoubleMise: true,
  };
}

// ─── メイン処理 ───────────────────────────────────────

/**
 * fullEval を実行し、結果とタイミング情報を返す
 *
 * review.worker.ts の fullEval パス（L249-763）と
 * scripts/profile-review.ts の profileMove 関数を統合したもの。
 */
export function executeFullEval(
  params: FullEvalParams,
): FullEvalResultWithTimings {
  const {
    moveHistory,
    moveIndex,
    preciseAnalysis,
    boardEvaluator,
    wasmSearchEngine,
  } = params;

  const profile = preciseAnalysis
    ? REVIEW_PROFILE_PRECISE
    : REVIEW_PROFILE_FAST;

  const timings: FullEvalTimings = {
    forcedWinDetection: 0,
    forcedLossCheck: 0,
    minimaxSearch: 0,
    vctRetry: 0,
    candidateVerification: 0,
    pvVerification: 0,
    total: 0,
  };

  const totalStart = performance.now();

  // 高速モード時は TT をクリア（決定論性）
  if (profile.clearTT) {
    globalTT.clear();
  }

  const moves = moveHistory.trim().split(/\s+/);

  // moveIndex時点の盤面を再構築（moveIndex手目の前の局面）
  const { board, nextColor } = createBoardFromRecord(
    moves.slice(0, moveIndex).join(" "),
  );

  const color = nextColor as "black" | "white";
  const opponentColor = color === "black" ? "white" : "black";

  // 相手の脅威チェック（VCF/VCT探索より先に実行）
  const opponentThreats = detectOpponentThreats(board, opponentColor);
  const opponentHasFour =
    opponentThreats.fours.length > 0 || opponentThreats.openFours.length > 0;

  // ─── 強制勝ち検出（VCF/VCT/両ミセ/Mise-VCF） ───
  let t0 = performance.now();
  let { forcedWin, forcedWinType, doubleMiseMoves, doubleMiseBestMove } =
    detectForcedWin(board, color, opponentHasFour, false);
  timings.forcedWinDetection = performance.now() - t0;

  // ─── 相手の必勝手順検出 ───
  let forcedLossType: ForcedLossType | undefined = undefined;
  let forcedLossSequence: Position[] | undefined = undefined;
  let needsVCTCheck = false;
  t0 = performance.now();
  if (moves[moveIndex]) {
    const { board: boardAfter } = createBoardFromRecord(
      moves.slice(0, moveIndex + 1).join(" "),
    );
    const stoneCountAfter = countStones(boardAfter);

    // 着手後の局面で、自分の四があるか（相手はVCF/VCTどころではない）
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
        forcedLossSequence = loss.sequence;
      } else {
        needsVCTCheck = true;
      }
    }
  }
  timings.forcedLossCheck = performance.now() - t0;

  // ─── Minimax探索 ───
  const hasForcedWin = Boolean(forcedWin || doubleMiseBestMove);
  const effectiveMaxNodes =
    profile.enablePVVerification && (forcedLossType || hasForcedWin)
      ? REVIEW_REDUCED_NODES
      : profile.maxNodes;

  t0 = performance.now();
  const result = wasmSearchEngine
    ? executeWasmSearch(
        wasmSearchEngine,
        board,
        color,
        effectiveMaxNodes,
        profile,
      )
    : findBestMoveIterativeWithTT({
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

  // ─── VCTリトライ ───
  t0 = performance.now();
  if (
    !forcedWin &&
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
      forcedWin = vctRetry;
      forcedWinType = vctRetry.isForbiddenTrap ? "forbidden-trap" : "vct";
    }
  }
  timings.vctRetry = performance.now() - t0;

  // 候補手エントリから内訳付きデータを構築するヘルパー
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

  // 両ミセ見逃し検出（forcedWinType が double-mise の場合のみ）
  let missedDoubleMise: Position[] | undefined = undefined;
  if (
    forcedWinType === "double-mise" &&
    doubleMiseMoves.length > 0 &&
    playedRow >= 0
  ) {
    const playedIsDoubleMise = doubleMiseMoves.some(
      (m) => m.row === playedRow && m.col === playedCol,
    );
    if (!playedIsDoubleMise) {
      missedDoubleMise = doubleMiseMoves;
    }
  }

  // VCT/VCF検出時とそれ以外で分岐
  if (forcedWin) {
    return buildForcedWinResult({
      board,
      color,
      opponentColor,
      forcedWin,
      forcedWinType,
      doubleMiseMoves,
      doubleMiseBestMove,
      result,
      buildCandidate,
      playedRow,
      playedCol,
      forcedLossType,
      forcedLossSequence,
      missedDoubleMise,
      needsVCTCheck,
      moveIndex,
      profile,
      timings,
      totalStart,
    });
  }

  return buildNormalResult({
    board,
    color,
    opponentColor,
    result,
    buildCandidate,
    playedRow,
    playedCol,
    forcedLossType,
    forcedLossSequence,
    missedDoubleMise,
    needsVCTCheck,
    moveIndex,
    profile,
    timings,
    totalStart,
  });
}

// ─── forcedWin パス ──────────────────────────────────

interface ForcedWinResultContext {
  board: BoardState;
  color: "black" | "white";
  opponentColor: "black" | "white";
  forcedWin: ForcedWinInfo;
  forcedWinType: ForcedWinType | undefined;
  doubleMiseMoves: Position[];
  doubleMiseBestMove: Position | null;
  result: ReturnType<typeof findBestMoveIterativeWithTT>;
  buildCandidate: (entry: MoveScoreEntry) => ReviewCandidate;
  playedRow: number;
  playedCol: number;
  forcedLossType: ForcedLossType | undefined;
  forcedLossSequence: Position[] | undefined;
  missedDoubleMise: Position[] | undefined;
  needsVCTCheck: boolean;
  moveIndex: number;
  profile: ReviewProfile;
  timings: FullEvalTimings;
  totalStart: number;
}

function buildForcedWinResult(
  ctx: ForcedWinResultContext,
): FullEvalResultWithTimings {
  const {
    board,
    color,
    opponentColor,
    result,
    buildCandidate,
    playedRow,
    playedCol,
    moveIndex,
    profile,
    timings,
    totalStart,
  } = ctx;
  let {
    forcedWin,
    forcedWinType,
    doubleMiseMoves,
    doubleMiseBestMove,
    forcedLossType,
    forcedLossSequence,
    missedDoubleMise,
    needsVCTCheck,
  } = ctx;

  const bestScore = PATTERN_SCORES.FIVE;
  const bestMove = forcedWin.firstMove;

  // 実際の手のスコア判定
  const { playedScore, playedForcedWinSequence } = evaluatePlayedForcedWin(
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

  // 両ミセターゲット算出（四三を作る位置）
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
  }

  // 候補手リスト構築
  const candidates: ReviewCandidate[] = [];

  // 追い詰め開始手をFIVEスコアで追加
  const { score: fwBreakdownScore, breakdown: fwBreakdown } =
    evaluatePositionWithBreakdown(
      board,
      bestMove.row,
      bestMove.col,
      color,
      REVIEW_SEARCH_PARAMS.evaluationOptions,
    );

  // 両ミセ: targets から読み筋を構築
  let bestPV: Position[] = forcedWin.sequence;
  if (
    forcedWinType === "double-mise" &&
    doubleMiseTargets &&
    doubleMiseTargets.length >= 2 &&
    doubleMiseTargets[0] &&
    doubleMiseTargets[1]
  ) {
    bestPV = [bestMove, doubleMiseTargets[0], doubleMiseTargets[1]];
  }

  candidates.push({
    position: bestMove,
    score: Math.round(fwBreakdownScore),
    searchScore: PATTERN_SCORES.FIVE,
    breakdown: fwBreakdown as ScoreBreakdown,
    principalVariation: bestPV,
  });

  // minimaxの候補手をマージ
  const minimaxCandidates = (result.candidates ?? [])
    .slice(0, 5)
    .filter(
      (e) => !(e.move.row === bestMove.row && e.move.col === bestMove.col),
    )
    .map(buildCandidate);
  candidates.push(...minimaxCandidates);

  // 実際の手の追い詰めシーケンスを候補に反映
  if (playedForcedWinSequence && playedRow >= 0) {
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
  } else if (
    playedRow >= 0 &&
    !candidates.some(
      (c) => c.position.row === playedRow && c.position.col === playedCol,
    )
  ) {
    const playedEntry = result.candidates?.find(
      (c) => c.move.row === playedRow && c.move.col === playedCol,
    );
    if (playedEntry) {
      candidates.push(buildCandidate(playedEntry));
    }
  }

  // 分岐情報の構築
  let forcedWinBranches: ForcedWinBranch[] | undefined = undefined;

  if (
    forcedWinType === "double-mise" &&
    doubleMiseTargets &&
    doubleMiseTargets.length >= 2
  ) {
    forcedWinBranches = buildDoubleMiseBranches(
      board,
      bestMove,
      color,
      opponentColor,
      doubleMiseTargets,
    );
  } else {
    const rawBranches =
      "branches" in forcedWin
        ? (forcedWin.branches as VCTBranch[] | undefined)
        : undefined;
    forcedWinBranches = rawBranches?.map((b) => ({
      defenseIndex: b.defenseIndex,
      defenseMove: b.defenseMove,
      continuation: b.continuation,
    }));
  }

  // ─── 候補手検証 ───
  const stoneCountFW = countStones(board);
  const fwBudget =
    profile.verifyCandidatesBudget === "dynamic"
      ? Math.max(1000, Math.min(5000, 25_000))
      : profile.verifyCandidatesBudget;
  let t0 = performance.now();
  const { demotedBest: fwDemoted, bestLoss: fwBestLoss } = verifyCandidates(
    board,
    candidates,
    color,
    opponentColor,
    stoneCountFW,
    fwBudget,
  );
  timings.candidateVerification = performance.now() - t0;

  // PV事後検証
  t0 = performance.now();
  if (profile.enablePVVerification) {
    verifyCandidatePVs(
      board,
      candidates,
      color,
      opponentColor,
      stoneCountFW,
      Infinity,
    );
  }
  timings.pvVerification = performance.now() - t0;

  // 打たれた手の候補エントリにforcedLossTypeを反映
  if (forcedLossType && playedRow >= 0) {
    const playedCand = candidates.find(
      (c) => c.position.row === playedRow && c.position.col === playedCol,
    );
    if (playedCand && !playedCand.opponentForcedWin) {
      playedCand.opponentForcedWin = forcedLossType;
    }
  }

  let finalBestMove = bestMove;
  let finalBestScore: number = bestScore;
  let fwForcedLossType: ForcedLossType | undefined =
    forcedLossType ?? undefined;
  let fwForcedLossSequence: Position[] | undefined =
    forcedLossSequence ?? undefined;

  // verifyCandidates または PV検証で最善手が降格された場合
  if (fwDemoted || candidates[0]?.opponentForcedWin) {
    const dm = handleDemotion({
      board,
      candidates,
      color,
      forcedWinType,
      bestMove,
      bestScore,
      fwBestLoss: fwBestLoss ?? undefined,
    });
    ({ forcedWinType } = dm);
    ({ finalBestMove } = dm);
    ({ finalBestScore } = dm);
    ({ forcedWinBranches } = dm);
    if (dm.fwForcedLossType) {
      ({ fwForcedLossType } = dm);
      ({ fwForcedLossSequence } = dm);
    }
    if (dm.clearDoubleMise) {
      missedDoubleMise = undefined;
      doubleMiseTargets = undefined;
    }
  }

  timings.total = performance.now() - totalStart;

  return {
    mode: "fullEval",
    moveIndex,
    bestMove: finalBestMove,
    bestScore: finalBestScore,
    playedScore,
    candidates,
    completedDepth: result.completedDepth,
    forcedWinType,
    forcedWinBranches,
    forcedLossType: fwForcedLossType,
    forcedLossSequence: fwForcedLossSequence,
    missedDoubleMise,
    doubleMiseTargets,
    needsVCTCheck: needsVCTCheck || undefined,
    timings,
  };
}

// ─── 通常パス ────────────────────────────────────────

interface NormalResultContext {
  board: BoardState;
  color: "black" | "white";
  opponentColor: "black" | "white";
  result: ReturnType<typeof findBestMoveIterativeWithTT>;
  buildCandidate: (entry: MoveScoreEntry) => ReviewCandidate;
  playedRow: number;
  playedCol: number;
  forcedLossType: ForcedLossType | undefined;
  forcedLossSequence: Position[] | undefined;
  missedDoubleMise: Position[] | undefined;
  needsVCTCheck: boolean;
  moveIndex: number;
  profile: ReviewProfile;
  timings: FullEvalTimings;
  totalStart: number;
}

function buildNormalResult(
  ctx: NormalResultContext,
): FullEvalResultWithTimings {
  const {
    board,
    color,
    opponentColor,
    result,
    buildCandidate,
    playedRow,
    playedCol,
    moveIndex,
    profile,
    timings,
    totalStart,
    missedDoubleMise,
    needsVCTCheck,
  } = ctx;
  let { forcedLossType, forcedLossSequence } = ctx;

  // 通常の評価フロー（VCT/VCFなし）
  let playedScore = result.score;

  if (playedRow >= 0 && result.candidates) {
    const played = result.candidates.find(
      (c) => c.move.row === playedRow && c.move.col === playedCol,
    );
    if (played) {
      playedScore = played.score;
    } else {
      playedScore = result.score - 2000;
    }
  }

  const candidates = (result.candidates ?? []).slice(0, 5).map(buildCandidate);

  if (
    playedRow >= 0 &&
    !candidates.some(
      (c) => c.position.row === playedRow && c.position.col === playedCol,
    )
  ) {
    const allCandidates = result.candidates ?? [];
    const playedEntry = allCandidates.find(
      (c) => c.move.row === playedRow && c.move.col === playedCol,
    );
    if (playedEntry) {
      candidates.push(buildCandidate(playedEntry));
    }
  }

  // ─── 候補手検証 ───
  const stoneCount = countStones(board);
  const normalBudget =
    profile.verifyCandidatesBudget === "dynamic"
      ? Math.max(1000, Math.min(5000, 25_000 - (result.elapsedTime ?? 0)))
      : profile.verifyCandidatesBudget;
  let t0 = performance.now();
  const { demotedBest, bestLoss } = verifyCandidates(
    board,
    candidates,
    color,
    opponentColor,
    stoneCount,
    normalBudget,
  );
  timings.candidateVerification = performance.now() - t0;

  // PV事後検証
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

  // 打たれた手の候補エントリにforcedLossTypeを反映
  if (forcedLossType && playedRow >= 0) {
    const playedCand = candidates.find(
      (c) => c.position.row === playedRow && c.position.col === playedCol,
    );
    if (playedCand && !playedCand.opponentForcedWin) {
      playedCand.opponentForcedWin = forcedLossType;
    }
  }

  let finalBestMove = result.position;
  let finalBestScore = result.score;
  // verifyCandidates または PV検証で最善手が降格された場合
  const bestDemoted = demotedBest || Boolean(candidates[0]?.opponentForcedWin);
  if (bestDemoted) {
    const safeBest = findSafeBest(candidates);
    if (safeBest) {
      finalBestMove = safeBest.position;
      finalBestScore = safeBest.searchScore;
    } else if (bestLoss && !forcedLossType) {
      // 全候補が被必勝 → 局面自体が被必勝
      forcedLossType = bestLoss.type;
      forcedLossSequence = bestLoss.sequence;
    }
  }

  timings.total = performance.now() - totalStart;

  return {
    mode: "fullEval",
    moveIndex,
    bestMove: finalBestMove,
    bestScore: finalBestScore,
    playedScore,
    candidates,
    completedDepth: result.completedDepth,
    forcedLossType,
    forcedLossSequence,
    missedDoubleMise,
    needsVCTCheck: needsVCTCheck || undefined,
    timings,
  };
}
