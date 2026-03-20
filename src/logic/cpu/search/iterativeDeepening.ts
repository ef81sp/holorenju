/**
 * 反復深化探索（TT統合版）
 *
 * Iterative Deepening + Aspiration Windows + 事前チェック（VCF/脅威防御）
 */

import type { BoardState, Position } from "@/types/game";

import {
  clearForbiddenCache,
  setCurrentBoardHash,
} from "../cache/forbiddenCache";
import { applyMove, countStones } from "../core/boardUtils";
import {
  DEFAULT_EVAL_OPTIONS,
  type EvaluationOptions,
} from "../evaluation/patternScores";
import { buildLineTable } from "../lineTable/lineTable";
import { generateSortedMoves } from "../moveGenerator";
import {
  getCounters,
  isProfilingEnabled,
  resetCounters,
} from "../profiling/counters";
import { globalTT } from "../transpositionTable";
import { computeBoardHash } from "../zobrist";
import { createSearchContext, type SearchStats } from "./context";
import { findBestMoveWithTT } from "./minimaxCore";
import { findPreSearchMove } from "./preSearch";
import {
  applyTimePressureFallback,
  type DepthHistoryEntry,
  type IterativeDeepingResult,
  type MinimaxResult,
} from "./results";
import {
  ASPIRATION_WINDOW,
  calculateDynamicTimeLimit,
  DEFAULT_ABSOLUTE_TIME_LIMIT,
  detectPlainFour,
  PLAIN_FOUR_PREFERENCE_MARGIN,
} from "./techniques";
import { findVCFMove, hasVCF } from "./vcf";

/**
 * プロファイリングカウンターの値をSearchStatsにマージ
 *
 * @param stats 探索統計
 * @returns カウンター値がマージされた統計
 */
function mergeProfilingCounters(stats: SearchStats): SearchStats {
  const counters = getCounters();
  return {
    ...stats,
    forbiddenCheckCalls: counters.forbiddenCheckCalls,
    boardCopies: counters.boardCopies,
    threatDetectionCalls: counters.threatDetectionCalls,
    evaluationCalls: counters.evaluationCalls,
    timings: isProfilingEnabled() ? counters.timings : undefined,
  };
}

/** VCF安全チェックの時間制限（ms） */
const PLAIN_FOUR_VCF_CHECK_TIME_LIMIT = 50;

/**
 * 非生産的四の優先度引き下げ
 *
 * 最善手が非生産的四（四を作るが活三を伴わない）で、非四手との
 * スコア差がマージン内なら非四手を優先する。
 * 四+ブロックの水平線効果でスコアが膨らんでいる疑いを補正する。
 *
 * VCFがある場合はdemoteしない。VCF四は通常threatProbeで探索中に
 * 検出されるため、ここに到達するVCF四はレアケース。
 * findVCFMove がタイムアウトした場合はVCFなしとみなす
 * （50msは通常のVCF探索に十分な時間）。
 */
function demotePlainFourIfNeeded<T extends MinimaxResult>(
  result: T,
  board: BoardState,
  color: "black" | "white",
): T {
  if (!result.candidates || result.candidates.length < 2) {
    return result;
  }

  const bestMove = result.position;
  const tempBoard = applyMove(board, bestMove, color);
  if (!detectPlainFour(tempBoard, bestMove.row, bestMove.col, color)) {
    return result;
  }

  // VCF安全チェック: VCFがあればdemoteしない
  const vcfMove = findVCFMove(board, color, {
    timeLimit: PLAIN_FOUR_VCF_CHECK_TIME_LIMIT,
  });
  if (vcfMove) {
    return result;
  }

  const bestNonFour = result.candidates.find((entry) => {
    const b = applyMove(board, entry.move, color);
    return !detectPlainFour(b, entry.move.row, entry.move.col, color);
  });
  if (
    bestNonFour &&
    result.score - bestNonFour.score < PLAIN_FOUR_PREFERENCE_MARGIN
  ) {
    return {
      ...result,
      position: bestNonFour.move,
      score: bestNonFour.score,
    } as T;
  }

  return result;
}

export interface IterativeDeepeningParams {
  board: BoardState;
  color: "black" | "white";
  maxDepth: number;
  timeLimit: number;
  randomFactor?: number;
  evaluationOptions?: EvaluationOptions;
  maxNodes?: number;
  absoluteTimeLimit?: number;
  scoreThreshold?: number;
  /** Triangular PV Tableによる正確なPV収集（振り返り用） */
  collectPV?: boolean;
}

/**
 * Iterative Deepeningで最善手を探索（TT統合版）
 */
export function findBestMoveIterativeWithTT(
  params: IterativeDeepeningParams,
): IterativeDeepingResult & { stats: SearchStats } {
  const {
    board,
    color,
    maxDepth,
    timeLimit,
    randomFactor = 0,
    evaluationOptions = DEFAULT_EVAL_OPTIONS,
    maxNodes,
    absoluteTimeLimit = DEFAULT_ABSOLUTE_TIME_LIMIT,
    scoreThreshold = 200,
    collectPV = false,
  } = params;
  const startTime = performance.now();
  const ctx = createSearchContext(globalTT, evaluationOptions);
  ctx.lineTable = buildLineTable(board);

  // プロファイリングカウンターをリセット
  resetCounters();

  // 禁手判定キャッシュをクリア
  clearForbiddenCache();

  // 初期盤面のハッシュを計算して設定
  const initialHash = computeBoardHash(board);
  setCurrentBoardHash(initialHash);

  // 新しい探索開始
  ctx.tt.newGeneration();

  // =========================================================================
  // 必須手の事前チェック（探索より優先）
  // =========================================================================

  const absoluteDeadline = startTime + absoluteTimeLimit;

  const preSearchResult = findPreSearchMove(
    board,
    color,
    ctx,
    evaluationOptions,
    absoluteDeadline,
  );

  // 即座に返すべき手がある場合
  if (preSearchResult.immediateMove) {
    return {
      position: preSearchResult.immediateMove.position,
      score: preSearchResult.immediateMove.score,
      completedDepth: 0,
      interrupted: false,
      elapsedTime: performance.now() - startTime,
      stats: mergeProfilingCounters(ctx.stats),
    };
  }

  // =========================================================================
  // 通常の探索
  // =========================================================================

  // 候補手を生成
  let { moves } = generateSortedMoves(board, color, {
    ttMove: null,
    killers: ctx.killers,
    depth: 1,
    history: ctx.history,
    useStaticEval: true,
    evaluationOptions,
  });

  // 候補手制限の適用（優先順: VCF防御 > 活三防御）
  // 各制限は候補手とのANDで適用し、空なら次の制限にフォールバック
  const restrictions = [
    preSearchResult.restrictedMoves,
    preSearchResult.openThreeDefenseMoves,
  ];
  for (const restriction of restrictions) {
    if (restriction && restriction.length > 0) {
      const restrictedSet = new Set(
        restriction.map((m) => `${m.row},${m.col}`),
      );
      const filtered = moves.filter((m) =>
        restrictedSet.has(`${m.row},${m.col}`),
      );
      if (filtered.length > 0) {
        moves = filtered;
        break;
      }
    }
  }

  // VCTヒント手がある場合、候補手の先頭に配置してminimax検証に委ねる
  if (preSearchResult.vctHintMove) {
    const hint = preSearchResult.vctHintMove;
    const hintKey = `${hint.row},${hint.col}`;
    // 重複を除去して先頭に配置
    moves = [hint, ...moves.filter((m) => `${m.row},${m.col}` !== hintKey)];
  }

  // ルートノード専用: フクミ手優先（上位5手のみVCF判定）
  // 着手後にVCFが生まれる手を候補リストの先頭に昇格。
  // evaluatePositionCoreには入れない（ホットパス保護）。
  if (evaluationOptions.enableFukumi && moves.length > 1) {
    const stoneCount = countStones(board);
    // 序盤（10手以下）はVCFが成立しにくいためスキップ
    if (stoneCount > 10) {
      const fukumiTopN = Math.min(5, moves.length);
      const fukumiMoves: Position[] = [];
      for (let i = 0; i < fukumiTopN; i++) {
        const move = moves[i];
        if (!move) {
          continue;
        }
        // インプレースで石を配置してVCF判定（着手後に自分のVCFがあるか）
        const boardRow = board[move.row];
        if (!boardRow) {
          continue;
        }
        boardRow[move.col] = color;
        const hasFukumi = hasVCF(board, color, 0, undefined, {
          timeLimit: 30,
        });
        boardRow[move.col] = null;
        if (hasFukumi) {
          fukumiMoves.push(move);
        }
      }
      // フクミ手を候補リストの先頭に昇格
      if (fukumiMoves.length > 0) {
        const fukumiSet = new Set(fukumiMoves.map((m) => `${m.row},${m.col}`));
        moves = [
          ...fukumiMoves,
          ...moves.filter((m) => !fukumiSet.has(`${m.row},${m.col}`)),
        ];
      }
    }
  }

  // deadline ベースの時間設定
  // VCF時間の特別扱いは撤廃: deadline = startTime + dynamicTimeLimit で
  // VCF時間は自然に予算に含まれる
  const dynamicTimeLimit = calculateDynamicTimeLimit(
    timeLimit,
    board,
    moves.length,
  );
  const searchDeadline = startTime + dynamicTimeLimit;
  ctx.deadline = searchDeadline;
  ctx.timeoutFlag = false;

  // ノード数上限を設定
  ctx.maxNodes = maxNodes;
  ctx.nodeCountExceeded = false;

  // 絶対停止タイムスタンプを設定
  ctx.absoluteDeadline = absoluteDeadline;
  ctx.absoluteDeadlineExceeded = false;

  // NOTE: Phase 6の最適化（precomputedThreats）は一旦無効化
  // 理由: 深いノードでは手番が変わるため、ルートノードで計算した脅威情報が
  // 不適切に使われる問題がある。毎回detectOpponentThreatsを呼ぶようにする。
  // 将来的には、ルートノードの候補手評価にのみ適用する形で最適化可能。

  // 唯一の候補手なら即座に返す
  if (moves.length === 1 && moves[0]) {
    return {
      position: moves[0],
      score: 0,
      completedDepth: 0,
      interrupted: false,
      elapsedTime: performance.now() - startTime,
      stats: mergeProfilingCounters(ctx.stats),
      forcedMove: true,
    };
  }

  // 深度履歴を記録
  const depthHistory: DepthHistoryEntry[] = [];

  // 初期結果（深さ1で必ず結果を得る）
  // 活三防御時はmovesが防御位置のみに制限されているので、それを渡す
  let bestResult = findBestMoveWithTT(
    board,
    color,
    1,
    randomFactor,
    ctx,
    undefined,
    moves,
    scoreThreshold,
    collectPV,
  );
  let completedDepth = 1;
  let interrupted = false;

  // 深度1の結果を記録
  depthHistory.push({
    depth: 1,
    position: bestResult.position,
    score: bestResult.score,
  });

  // 深さ2から開始して、時間制限内で可能な限り深く探索
  // ループ内で使う deadline（0.8倍 = 残り20%の時間を確保）
  const loopDeadline = startTime + dynamicTimeLimit * 0.8;

  for (let depth = 2; depth <= maxDepth; depth++) {
    // PVムーブを先頭に移動（move ordering最適化）
    const pvMove = bestResult.position;
    const pvIndex = moves.findIndex(
      (m) => m.row === pvMove.row && m.col === pvMove.col,
    );
    if (pvIndex > 0) {
      const [pv] = moves.splice(pvIndex, 1);
      if (pv) {
        moves.unshift(pv);
      }
    }

    const now = performance.now();

    // 絶対時間制限チェック
    if (now >= absoluteDeadline) {
      ctx.absoluteDeadlineExceeded = true;
      interrupted = true;
      break;
    }

    // 動的時間制限チェック（deadline ベース）
    if (now >= loopDeadline || ctx.timeoutFlag || ctx.nodeCountExceeded) {
      interrupted = true;
      break;
    }

    // Aspiration Windowsで探索
    let result = findBestMoveWithTT(
      board,
      color,
      depth,
      randomFactor,
      ctx,
      {
        previousScore: bestResult.score,
        windowSize: ASPIRATION_WINDOW,
      },
      moves,
      scoreThreshold,
      collectPV,
    );

    // 探索中にタイムアウト、ノード数上限、または絶対時間制限に達した場合は前の結果を使用
    if (
      ctx.timeoutFlag ||
      ctx.nodeCountExceeded ||
      ctx.absoluteDeadlineExceeded
    ) {
      interrupted = true;
      break;
    }

    // ウィンドウ外の結果が出たら再探索（フルウィンドウ）
    const lowerBound = bestResult.score - ASPIRATION_WINDOW;
    const upperBound = bestResult.score + ASPIRATION_WINDOW;
    if (result.score <= lowerBound || result.score >= upperBound) {
      // 再探索（フルウィンドウ）
      result = findBestMoveWithTT(
        board,
        color,
        depth,
        randomFactor,
        ctx,
        undefined,
        moves,
        scoreThreshold,
        collectPV,
      );

      // 再探索中にタイムアウト、ノード数上限、または絶対時間制限に達した場合
      if (
        ctx.timeoutFlag ||
        ctx.nodeCountExceeded ||
        ctx.absoluteDeadlineExceeded
      ) {
        interrupted = true;
        break;
      }
    }

    // 深度履歴に記録
    depthHistory.push({
      depth,
      position: result.position,
      score: result.score,
    });

    // ループ末尾の deadline チェック
    if (performance.now() >= searchDeadline) {
      bestResult = result;
      completedDepth = depth;
      interrupted = true;
      break;
    }

    bestResult = result;
    completedDepth = depth;
  }

  // =========================================================================
  // Score Verification Extension
  // スコアが大幅に変化した場合に+1深度を追加探索
  // 主な対象: d3完了→d4中断のケース（time-pressure-error の軽減）
  // =========================================================================
  const VERIFICATION_THRESHOLD = 1500; // FOUR相当
  if (
    depthHistory.length >= 2 &&
    completedDepth < maxDepth &&
    !ctx.absoluteDeadlineExceeded &&
    !ctx.nodeCountExceeded &&
    performance.now() < loopDeadline
  ) {
    const last = depthHistory[depthHistory.length - 1];
    const prev = depthHistory[depthHistory.length - 2];
    if (
      last &&
      prev &&
      Math.abs(last.score - prev.score) >= VERIFICATION_THRESHOLD
    ) {
      // Aspiration Window付きで検証探索
      const verifyResult = findBestMoveWithTT(
        board,
        color,
        completedDepth + 1,
        randomFactor,
        ctx,
        { previousScore: last.score, windowSize: ASPIRATION_WINDOW },
        moves,
        scoreThreshold,
      );
      if (
        !ctx.timeoutFlag &&
        !ctx.nodeCountExceeded &&
        !ctx.absoluteDeadlineExceeded
      ) {
        depthHistory.push({
          depth: completedDepth + 1,
          position: verifyResult.position,
          score: verifyResult.score,
        });
        bestResult = verifyResult;
        completedDepth += 1;
      }
    }
  }

  bestResult = demotePlainFourIfNeeded(bestResult, board, color);

  const finalResult: IterativeDeepingResult & { stats: SearchStats } = {
    position: bestResult.position,
    score: bestResult.score,
    candidates: bestResult.candidates,
    randomSelection: bestResult.randomSelection,
    completedDepth,
    interrupted,
    elapsedTime: performance.now() - startTime,
    depthHistory,
    stats: mergeProfilingCounters(ctx.stats),
  };
  return applyTimePressureFallback(
    finalResult,
    depthHistory,
    interrupted,
  ) as typeof finalResult;
}
