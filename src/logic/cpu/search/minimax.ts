/**
 * Minimax + Alpha-Beta剪定
 *
 * 「相手は最善手を打つ」と仮定し、数手先を読んで最良の手を選ぶ
 */

import type { BoardState, Position, StoneColor } from "@/types/game";

import { checkFive, checkWin } from "@/logic/renjuRules";

import {
  checkForbiddenMoveWithCache,
  clearForbiddenCache,
  setCurrentBoardHash,
} from "../cache/forbiddenCache";
import {
  applyMove,
  applyMoveInPlace,
  getOppositeColor,
  undoMove,
} from "../core/boardUtils";
import {
  DEFAULT_EVAL_OPTIONS,
  detectOpponentThreats,
  evaluateBoard,
  evaluatePosition,
  PATTERN_SCORES,
  type EvaluationOptions,
} from "../evaluation";
import {
  generateMoves,
  generateSortedMoves,
  recordKillerMove,
  updateHistory,
} from "../moveGenerator";
import { getCounters, resetCounters } from "../profiling/counters";
import { globalTT, type ScoreType } from "../transpositionTable";
import { computeBoardHash, updateHash } from "../zobrist";
import {
  createSearchContext,
  type SearchContext,
  type SearchStats,
} from "./context";
import { isMeasuringFutility, recordFutilityGain } from "./futilityMeasurement";
import { findMiseVCFMove } from "./miseVcf";
import {
  applyTimePressureFallback,
  extractPV,
  type DepthHistoryEntry,
  type IterativeDeepingResult,
  type MinimaxResult,
  type MoveScoreEntry,
} from "./results";
import {
  ASPIRATION_WINDOW,
  calculateDynamicTimeLimit,
  DEFAULT_ABSOLUTE_TIME_LIMIT,
  FUTILITY_MARGINS,
  hasImmediateThreat,
  INFINITY,
  isTacticalMove,
  LMR_MIN_DEPTH,
  LMR_MOVE_THRESHOLD,
  LMR_REDUCTION,
  NMP_MIN_DEPTH,
  NMP_REDUCTION,
} from "./techniques";
import {
  findFourMoves,
  findVCFSequence,
  findWinningMove,
  getFourDefensePosition,
  type VCFSequenceResult,
} from "./vcf";

// Re-export types and functions for backward compatibility
export {
  createSearchContext,
  type SearchContext,
  type SearchStats,
} from "./context";
export {
  extractPV,
  type DepthHistoryEntry,
  type IterativeDeepingResult,
  type MinimaxResult,
  type MoveScoreEntry,
  type PVExtractionResult,
  type RandomSelectionResult,
} from "./results";

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
  };
}

/**
 * 終端条件をチェック
 *
 * @param board 盤面
 * @param lastMove 最後の着手
 * @param color 最後の着手の色
 * @returns 終端（勝敗決定）ならtrue
 */
function isTerminal(
  board: BoardState,
  lastMove: Position | null,
  color: StoneColor,
): boolean {
  if (!lastMove || !color) {
    return false;
  }
  return checkWin(board, lastMove, color);
}

/**
 * Minimax探索（Alpha-Beta剪定付き）
 *
 * @param board 盤面
 * @param depth 残り探索深度
 * @param isMaximizing 最大化プレイヤーの手番か
 * @param perspective 評価の視点
 * @param alpha Alpha値
 * @param beta Beta値
 * @param lastMove 最後の着手位置
 * @returns 評価スコア
 */
export function minimax(
  board: BoardState,
  depth: number,
  isMaximizing: boolean,
  perspective: "black" | "white",
  alphaInit: number = -INFINITY,
  betaInit: number = INFINITY,
  lastMove: Position | null = null,
): number {
  // 現在の手番を決定
  const currentColor: "black" | "white" = isMaximizing
    ? perspective
    : getOppositeColor(perspective);

  const lastMoveColor: "black" | "white" = getOppositeColor(currentColor);

  // Alpha-Beta値をローカル変数にコピー（再代入可能にするため）
  let alpha = alphaInit;
  let beta = betaInit;

  // 終端条件チェック（前の手番で勝敗が決まった場合）
  if (lastMove && isTerminal(board, lastMove, lastMoveColor)) {
    // 前の手番のプレイヤーが勝った
    if (lastMoveColor === perspective) {
      return PATTERN_SCORES.FIVE;
    }
    return -PATTERN_SCORES.FIVE;
  }

  // 探索深度が0になった場合は盤面評価
  // この関数はctxを持たないので、デフォルト（ペナルティなし）で評価
  if (depth === 0) {
    return evaluateBoard(board, perspective);
  }

  // 候補手生成
  const moves = generateMoves(board, currentColor);

  // 候補手がない場合は引き分け
  if (moves.length === 0) {
    return 0;
  }

  if (isMaximizing) {
    let maxScore = -INFINITY;

    for (const move of moves) {
      const newBoard = applyMove(board, move, currentColor);

      const score = minimax(
        newBoard,
        depth - 1,
        false,
        perspective,
        alpha,
        beta,
        move,
      );

      maxScore = Math.max(maxScore, score);
      alpha = Math.max(alpha, score);

      // Beta剪定
      if (beta <= alpha) {
        break;
      }
    }

    return maxScore;
  }
  let minScore = INFINITY;

  for (const move of moves) {
    const newBoard = applyMove(board, move, currentColor);

    const score = minimax(
      newBoard,
      depth - 1,
      true,
      perspective,
      alpha,
      beta,
      move,
    );

    minScore = Math.min(minScore, score);
    beta = Math.min(beta, score);

    // Alpha剪定
    if (beta <= alpha) {
      break;
    }
  }

  return minScore;
}

/**
 * 最善手を探索
 *
 * @param board 盤面
 * @param color 手番の色
 * @param depth 探索深度
 * @param randomFactor ランダム要素（0-1）
 * @param scoreThreshold ランダム選択時の許容スコア差
 * @returns 最善手と評価スコア
 */
export function findBestMove(
  board: BoardState,
  color: "black" | "white",
  depth: number,
  randomFactor = 0,
  scoreThreshold = 200,
): MinimaxResult {
  const moves = generateMoves(board, color);

  if (moves.length === 0) {
    // 候補手がない場合（通常は発生しない）
    return {
      position: { row: 7, col: 7 },
      score: 0,
    };
  }

  if (moves.length === 1) {
    // 候補が1つしかない場合
    const [move] = moves;
    if (!move) {
      return {
        position: { row: 7, col: 7 },
        score: 0,
      };
    }
    return {
      position: move,
      score: evaluatePosition(board, move.row, move.col, color),
    };
  }

  // 各候補手を評価
  interface MoveScore {
    move: Position;
    score: number;
  }
  const moveScores: MoveScore[] = [];

  for (const move of moves) {
    const newBoard = applyMove(board, move, color);

    // Minimaxで評価（次は相手の手番なのでfalse）
    const score = minimax(
      newBoard,
      depth - 1,
      false,
      color,
      -INFINITY,
      INFINITY,
      move,
    );

    moveScores.push({ move, score });
  }

  // スコアでソート（降順）
  moveScores.sort((a, b) => b.score - a.score);

  // ランダム要素を適用
  if (
    randomFactor > 0 &&
    Math.random() < randomFactor &&
    moveScores.length > 1
  ) {
    // スコア差ベースでランダム選択範囲を制限（ベストからscoreThreshold点以内）
    const bestScore = moveScores[0]?.score ?? 0;
    const validMoves = moveScores.filter(
      (m) => m.score >= bestScore - scoreThreshold,
    );
    if (validMoves.length > 1) {
      const randomIndex = Math.floor(Math.random() * validMoves.length);
      const selected = validMoves[randomIndex];
      if (selected) {
        return {
          position: selected.move,
          score: selected.score,
        };
      }
    }
  }

  // 最高スコアの手を返す
  const [best] = moveScores;
  if (!best) {
    return {
      position: { row: 7, col: 7 },
      score: 0,
    };
  }

  return {
    position: best.move,
    score: best.score,
  };
}

/**
 * Iterative Deepeningで最善手を探索
 *
 * 深さ1から始めて、時間制限内で可能な限り深く探索する。
 * 時間切れになった場合は、最後に完了した深さの結果を返す。
 *
 * @param board 盤面
 * @param color 手番の色
 * @param maxDepth 最大探索深度
 * @param timeLimit 時間制限（ミリ秒）
 * @param randomFactor ランダム要素（0-1）
 * @param scoreThreshold ランダム選択時の許容スコア差
 * @returns 最善手と探索情報
 */
export function findBestMoveIterative(
  board: BoardState,
  color: "black" | "white",
  maxDepth: number,
  timeLimit: number,
  randomFactor = 0,
  scoreThreshold = 200,
): IterativeDeepingResult {
  const startTime = performance.now();

  // 初期結果（深さ1で必ず結果を得る）
  let bestResult = findBestMove(board, color, 1, randomFactor, scoreThreshold);
  let completedDepth = 1;
  let interrupted = false;

  // 深さ2から開始して、時間制限内で可能な限り深く探索
  for (let depth = 2; depth <= maxDepth; depth++) {
    const elapsedTime = performance.now() - startTime;

    // 時間制限チェック（次の深さを探索する余裕があるか）
    // 探索時間は深さとともに指数関数的に増加するため、
    // 残り時間が経過時間の半分以下なら中断
    if (elapsedTime > timeLimit * 0.5) {
      interrupted = true;
      break;
    }

    // 深さdで探索
    const result = findBestMove(
      board,
      color,
      depth,
      randomFactor,
      scoreThreshold,
    );

    // 探索完了後の時間チェック
    const currentTime = performance.now() - startTime;
    if (currentTime >= timeLimit) {
      // 時間オーバーだが、このdepthの結果は使用可能
      bestResult = result;
      completedDepth = depth;
      interrupted = true;
      break;
    }

    // 結果を更新
    bestResult = result;
    completedDepth = depth;
  }

  return {
    position: bestResult.position,
    score: bestResult.score,
    completedDepth,
    interrupted,
    elapsedTime: performance.now() - startTime,
  };
}

// =============================================================================
// Transposition Table 統合版
// =============================================================================

/**
 * Aspiration Windows用オプション
 */
interface AspirationOptions {
  /** 前回のスコア（Aspiration Windowsの中心） */
  previousScore?: number;
  /** ウィンドウ幅 */
  windowSize?: number;
}

/**
 * Minimax探索（TT/Move Ordering統合版）
 *
 * @param board 盤面
 * @param hash 現在の盤面ハッシュ
 * @param depth 残り探索深度
 * @param isMaximizing 最大化プレイヤーの手番か
 * @param perspective 評価の視点
 * @param alphaInit Alpha値
 * @param betaInit Beta値
 * @param lastMove 最後の着手位置
 * @param ctx 探索コンテキスト
 * @returns 評価スコア
 */

export function minimaxWithTT(
  board: BoardState,
  hash: bigint,
  depth: number,
  isMaximizing: boolean,
  perspective: "black" | "white",
  alphaInit: number,
  betaInit: number,
  lastMove: Position | null,
  ctx: SearchContext,
  allowNullMove = true,
): number {
  ctx.stats.nodes++;

  // ノード数上限チェック
  if (
    !ctx.nodeCountExceeded &&
    ctx.maxNodes !== undefined &&
    ctx.stats.nodes >= ctx.maxNodes
  ) {
    ctx.nodeCountExceeded = true;
  }

  // 時間制限チェック（一定ノード数ごと）
  // 毎回チェックするとオーバーヘッドが大きいため、一定間隔でチェック
  if (ctx.deadline !== undefined && ctx.stats.nodes % 4 === 0) {
    const now = performance.now();
    if (!ctx.timeoutFlag && now >= ctx.deadline) {
      ctx.timeoutFlag = true;
    }
    if (
      !ctx.absoluteDeadlineExceeded &&
      ctx.absoluteDeadline !== undefined &&
      now >= ctx.absoluteDeadline
    ) {
      ctx.absoluteDeadlineExceeded = true;
    }
  }

  // 時間切れ、ノード数上限、または絶対時間制限超過なら即座に現在の評価を返す
  if (
    ctx.timeoutFlag ||
    ctx.nodeCountExceeded ||
    ctx.absoluteDeadlineExceeded
  ) {
    return evaluateBoard(board, perspective, {
      singleFourPenaltyMultiplier:
        ctx.evaluationOptions.singleFourPenaltyMultiplier,
    });
  }

  // 現在の手番を決定
  const currentColor: "black" | "white" = isMaximizing
    ? perspective
    : getOppositeColor(perspective);
  const lastMoveColor: "black" | "white" = getOppositeColor(currentColor);

  let alpha = alphaInit;
  let beta = betaInit;

  // 終端条件チェック
  if (lastMove && isTerminal(board, lastMove, lastMoveColor)) {
    if (lastMoveColor === perspective) {
      return PATTERN_SCORES.FIVE;
    }
    return -PATTERN_SCORES.FIVE;
  }

  // TTプローブ
  const ttEntry = ctx.tt.probe(hash);
  let ttMove: Position | null = null;

  if (ttEntry && ttEntry.depth >= depth) {
    ctx.stats.ttHits++;

    switch (ttEntry.type) {
      case "EXACT":
        ctx.stats.ttCutoffs++;
        return ttEntry.score;
      case "LOWER_BOUND":
        alpha = Math.max(alpha, ttEntry.score);
        break;
      case "UPPER_BOUND":
        beta = Math.min(beta, ttEntry.score);
        break;
      default:
        // ScoreTypeは3種類のみなので到達しない
        break;
    }

    if (alpha >= beta) {
      ctx.stats.ttCutoffs++;
      return ttEntry.score;
    }

    ttMove = ttEntry.bestMove;
  }

  // 探索深度が0になった場合は盤面評価
  if (depth === 0) {
    const score = evaluateBoard(board, perspective, {
      singleFourPenaltyMultiplier:
        ctx.evaluationOptions.singleFourPenaltyMultiplier,
    });
    ctx.tt.store(hash, score, depth, "EXACT", null);
    return score;
  }

  // =========================================================================
  // Null Move Pruning (NMP)
  // 手番をパス（何も打たない）して浅く探索し、それでも有利なら枝刈り
  // =========================================================================
  if (
    ctx.evaluationOptions.enableNullMovePruning &&
    allowNullMove &&
    depth >= NMP_MIN_DEPTH &&
    !hasImmediateThreat(board, getOppositeColor(currentColor))
  ) {
    const nmpScore = minimaxWithTT(
      board,
      hash,
      depth - 1 - NMP_REDUCTION,
      !isMaximizing,
      perspective,
      alpha,
      beta,
      lastMove,
      ctx,
      false, // 連続NMP防止
    );
    if (isMaximizing ? nmpScore >= beta : nmpScore <= alpha) {
      ctx.stats.nullMoveCutoffs++;
      return nmpScore;
    }
  }

  // ソート済み候補手生成（Lazy Evaluation: 深さに応じて動的調整）
  // depth 1では通常は静的評価をスキップ（リーフノードはevaluateBoardで評価されるため）
  // ただし必須防御が有効な場合はdepth 1でも静的評価を実行
  // （脅威を無視する手をTTに保存しないため）
  // 深いノードほど評価数を減らして高速化
  // 黒番の禁手判定は遅延評価（実際に探索する手のみチェック）
  const useStaticEval =
    depth > 1 || ctx.evaluationOptions.enableMandatoryDefense;
  const getMaxStaticEvalCount = (d: number): number => {
    if (d >= 4) {
      return 3;
    }
    if (d >= 3) {
      return 5;
    }
    return 8;
  };
  const maxStaticEvalCount = getMaxStaticEvalCount(depth);
  const isBlackTurn = currentColor === "black";
  const moves = generateSortedMoves(board, currentColor, {
    ttMove,
    killers: ctx.killers,
    depth,
    history: ctx.history,
    useStaticEval,
    evaluationOptions: ctx.evaluationOptions,
    maxStaticEvalCount,
    // 黒番の禁手判定を遅延（Alpha-Beta枝刈りで探索されない手はチェック不要）
    skipForbiddenCheck: isBlackTurn,
  });

  if (moves.length === 0) {
    return 0;
  }

  let bestMove: Position | null = null;
  let bestScore = isMaximizing ? -INFINITY : INFINITY;
  let scoreType: ScoreType = isMaximizing ? "UPPER_BOUND" : "LOWER_BOUND";

  for (let moveIndex = 0; moveIndex < moves.length; moveIndex++) {
    const move = moves[moveIndex];
    if (!move) {
      continue;
    }

    // 遅延禁手判定（黒番の場合）
    // Alpha-Beta枝刈りで探索されない手は禁手チェック不要なため、ここで判定
    if (isBlackTurn) {
      // 五連が作れる場合は禁手でも打てる
      if (!checkFive(board, move.row, move.col, "black")) {
        const forbiddenResult = checkForbiddenMoveWithCache(
          board,
          move.row,
          move.col,
          hash,
        );
        if (forbiddenResult.isForbidden) {
          continue; // 禁手はスキップ
        }
      }
    }

    // Futility マージン計測: 対象ノードの staticEval を記録
    let futilityMeasureStaticEval: number | undefined;
    if (
      isMeasuringFutility() &&
      depth >= 1 &&
      depth <= 4 &&
      moveIndex > 0 &&
      bestScore > -PATTERN_SCORES.FIVE + 5000 &&
      bestScore < PATTERN_SCORES.FIVE - 5000 &&
      !isTacticalMove(board, move, currentColor)
    ) {
      futilityMeasureStaticEval = evaluatePosition(
        board,
        move.row,
        move.col,
        currentColor,
        ctx.evaluationOptions,
      );
    }

    // Futility Pruning（depth 1-2 の非戦術手をスキップ）
    // 静的評価＋マージンが alpha/beta を超えない手は探索不要
    if (
      ctx.evaluationOptions.enableFutilityPruning &&
      depth >= 1 &&
      depth <= 3 &&
      moveIndex > 0 && // 最初の手はスキップしない
      bestScore > -PATTERN_SCORES.FIVE + 5000 && // 勝ち/負け確定でない
      bestScore < PATTERN_SCORES.FIVE - 5000 &&
      !isTacticalMove(board, move, currentColor) // 四を作る手は除外
    ) {
      const futilityMargin = FUTILITY_MARGINS[depth] ?? 0;
      const staticEval = evaluatePosition(
        board,
        move.row,
        move.col,
        currentColor,
        ctx.evaluationOptions,
      );
      if (
        isMaximizing
          ? staticEval + futilityMargin <= alpha
          : staticEval - futilityMargin >= beta
      ) {
        ctx.stats.futilityPrunes++;
        continue;
      }
    }

    // LMR判定は石を置く前に行う（isTacticalMoveが元の盤面を参照するため）
    const canApplyLMR =
      moveIndex >= LMR_MOVE_THRESHOLD &&
      depth >= LMR_MIN_DEPTH &&
      bestScore > -PATTERN_SCORES.FIVE + 1000 && // 負けが確定していない
      !isTacticalMove(board, move, currentColor); // 四を作る手は除外

    // 石を配置（インプレース変更）
    applyMoveInPlace(board, move, currentColor);
    const newHash = updateHash(hash, move.row, move.col, currentColor);

    // 禁手キャッシュ用に現在の盤面ハッシュを更新
    setCurrentBoardHash(newHash);

    let score = 0;

    // LMR (Late Move Reductions)
    // 後半の候補手は浅く探索し、有望なら再探索
    // ただし、四を作る手（タクティカルな手）は除外
    if (canApplyLMR) {
      // 浅い探索
      score = minimaxWithTT(
        board,
        newHash,
        depth - 1 - LMR_REDUCTION,
        !isMaximizing,
        perspective,
        alpha,
        beta,
        move,
        ctx,
      );

      // 有望な結果なら再探索
      const needsResearch = isMaximizing ? score > alpha : score < beta;

      if (needsResearch) {
        score = minimaxWithTT(
          board,
          newHash,
          depth - 1,
          !isMaximizing,
          perspective,
          alpha,
          beta,
          move,
          ctx,
        );
      }
    } else {
      // 通常の探索
      score = minimaxWithTT(
        board,
        newHash,
        depth - 1,
        !isMaximizing,
        perspective,
        alpha,
        beta,
        move,
        ctx,
      );
    }

    // 石を元に戻す（Undo）
    undoMove(board, move);

    // 禁手キャッシュ用に盤面ハッシュを元に戻す
    setCurrentBoardHash(hash);

    // Futility マージン計測: gain を記録
    if (futilityMeasureStaticEval !== undefined) {
      const gain = isMaximizing
        ? Math.max(0, score - futilityMeasureStaticEval)
        : Math.max(0, futilityMeasureStaticEval - score);
      recordFutilityGain(depth, gain);
    }

    if (isMaximizing) {
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, score);
    } else {
      if (score < bestScore) {
        bestScore = score;
        bestMove = move;
      }
      beta = Math.min(beta, score);
    }

    // 剪定チェック
    if (beta <= alpha) {
      ctx.stats.betaCutoffs++;
      recordKillerMove(ctx.killers, depth, move);
      updateHistory(ctx.history, move, depth);
      scoreType = isMaximizing ? "LOWER_BOUND" : "UPPER_BOUND";
      break;
    }
  }

  // スコアタイプを決定
  if (beta > alpha) {
    if (isMaximizing && bestScore > alphaInit) {
      scoreType = "EXACT";
    } else if (!isMaximizing && bestScore < betaInit) {
      scoreType = "EXACT";
    }
  }

  // TTに保存
  ctx.tt.store(hash, bestScore, depth, scoreType, bestMove);

  return bestScore;
}

/**
 * 最善手を探索（TT統合版）
 *
 * @param board 盤面
 * @param color 手番の色
 * @param depth 探索深度
 * @param randomFactor ランダム要素（0-1）
 * @param ctx 探索コンテキスト（省略時は新規作成）
 * @param aspiration Aspiration Windowsオプション
 * @param restrictedMoves 候補手の制限
 * @param scoreThreshold ランダム選択時の許容スコア差
 * @returns 最善手と評価スコア
 */
export function findBestMoveWithTT(
  board: BoardState,
  color: "black" | "white",
  depth: number,
  randomFactor = 0,
  ctx: SearchContext = createSearchContext(),
  aspiration?: AspirationOptions,
  restrictedMoves?: Position[],
  scoreThreshold = 200,
): MinimaxResult & { ctx: SearchContext } {
  const hash = computeBoardHash(board);

  // TTからの前回の最善手を取得
  const ttEntry = ctx.tt.probe(hash);
  const ttMove = ttEntry?.bestMove ?? null;

  // 制限された候補手があればそれを使う、なければ通常の候補手生成
  const moves =
    restrictedMoves ??
    generateSortedMoves(board, color, {
      ttMove,
      killers: ctx.killers,
      depth,
      history: ctx.history,
      useStaticEval: true,
      evaluationOptions: ctx.evaluationOptions,
    });

  if (moves.length === 0) {
    return {
      position: { row: 7, col: 7 },
      score: 0,
      ctx,
    };
  }

  if (moves.length === 1) {
    const [move] = moves;
    if (!move) {
      return {
        position: { row: 7, col: 7 },
        score: 0,
        ctx,
      };
    }
    const score = evaluatePosition(
      board,
      move.row,
      move.col,
      color,
      ctx.evaluationOptions,
    );
    return {
      position: move,
      score,
      candidates: [{ move, score }],
      ctx,
    };
  }

  const moveScores: MoveScoreEntry[] = [];

  // Aspiration Windows: 前回のスコアをもとにウィンドウを設定
  const windowSize = aspiration?.windowSize ?? ASPIRATION_WINDOW;
  const prevScore = aspiration?.previousScore;
  let alpha = prevScore === undefined ? -INFINITY : prevScore - windowSize;
  let beta = prevScore === undefined ? INFINITY : prevScore + windowSize;

  for (const move of moves) {
    // タイムアウト・制限チェック
    if (
      ctx.timeoutFlag ||
      ctx.nodeCountExceeded ||
      ctx.absoluteDeadlineExceeded
    ) {
      break;
    }

    const newBoard = applyMove(board, move, color);
    const newHash = updateHash(hash, move.row, move.col, color);

    const score = minimaxWithTT(
      newBoard,
      newHash,
      depth - 1,
      false,
      color,
      alpha,
      beta,
      move,
      ctx,
    );

    // PVを抽出
    const pvResult = extractPV(board, hash, move, color, ctx.tt, depth);

    moveScores.push({
      move,
      score,
      pv: pvResult.pv,
      pvLeafBoard: pvResult.leafBoard,
      pvLeafColor: pvResult.leafColor,
    });
    alpha = Math.max(alpha, score);
  }

  moveScores.sort((a, b) => b.score - a.score);

  // ランダム要素を適用
  if (
    randomFactor > 0 &&
    Math.random() < randomFactor &&
    moveScores.length > 1
  ) {
    // スコア差ベースでランダム選択範囲を制限（ベストからscoreThreshold点以内）
    const bestScore = moveScores[0]?.score ?? 0;
    const validMoves = moveScores.filter(
      (m) => m.score >= bestScore - scoreThreshold,
    );
    if (validMoves.length > 1) {
      const randomIndex = Math.floor(Math.random() * validMoves.length);
      const selected = validMoves[randomIndex];
      if (selected) {
        // 元の順位を計算
        const originalRank =
          moveScores.findIndex((m) => m.move === selected.move) + 1;
        return {
          position: selected.move,
          score: selected.score,
          candidates: moveScores,
          randomSelection: {
            wasRandom: true,
            originalRank,
            candidateCount: validMoves.length,
          },
          ctx,
        };
      }
    }
  }

  const [best] = moveScores;
  if (!best) {
    return {
      position: { row: 7, col: 7 },
      score: 0,
      ctx,
    };
  }

  return {
    position: best.move,
    score: best.score,
    candidates: moveScores,
    randomSelection: {
      wasRandom: false,
      originalRank: 1,
      candidateCount: moveScores.length,
    },
    ctx,
  };
}

/**
 * Iterative Deepeningで最善手を探索（TT統合版）
 *
 * @param board 盤面
 * @param color 手番の色
 * @param maxDepth 最大探索深度
 * @param timeLimit 時間制限（ミリ秒）
 * @param randomFactor ランダム要素（0-1）
 * @param evaluationOptions 評価オプション
 * @param maxNodes ノード数上限（省略時は無制限）
 * @param absoluteTimeLimit 絶対時間制限（ミリ秒、デフォルト: 10000ms）
 * @param scoreThreshold ランダム選択時の許容スコア差（デフォルト: 200）
 * @returns 最善手と探索情報
 */
export function findBestMoveIterativeWithTT(
  board: BoardState,
  color: "black" | "white",
  maxDepth: number,
  timeLimit: number,
  randomFactor = 0,
  evaluationOptions: EvaluationOptions = DEFAULT_EVAL_OPTIONS,
  maxNodes?: number,
  absoluteTimeLimit: number = DEFAULT_ABSOLUTE_TIME_LIMIT,
  scoreThreshold = 200,
): IterativeDeepingResult & { stats: SearchStats } {
  const startTime = performance.now();
  const ctx = createSearchContext(globalTT, evaluationOptions);

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

  // 絶対時間制限チェック（VCF探索前）
  const absoluteDeadline = startTime + absoluteTimeLimit;
  if (performance.now() >= absoluteDeadline) {
    // 時間がないので即座に簡易評価で返す（上位5手のみ評価）
    const moves = generateSortedMoves(board, color, {
      ttMove: null,
      killers: ctx.killers,
      depth: 1,
      history: ctx.history,
      useStaticEval: true,
      evaluationOptions,
      maxStaticEvalCount: 5,
    });
    const fallbackMove = moves[0] ?? { row: 7, col: 7 };
    return {
      position: fallbackMove,
      score: 0,
      completedDepth: 0,
      interrupted: true,
      elapsedTime: performance.now() - startTime,
      stats: mergeProfilingCounters(ctx.stats),
    };
  }

  // 1. 自分の即勝ち手（五連完成）をチェック
  const winMove = findWinningMove(board, color);
  if (winMove) {
    return {
      position: winMove,
      score: PATTERN_SCORES.FIVE,
      completedDepth: 0,
      interrupted: false,
      elapsedTime: performance.now() - startTime,
      stats: mergeProfilingCounters(ctx.stats),
    };
  }

  // 2. 相手の脅威（活四・止め四・活三）をチェック
  const opponentColor = color === "black" ? "white" : "black";
  const threats = detectOpponentThreats(board, opponentColor);

  // 相手の活四があれば止める（実際には止められないが）
  if (threats.openFours.length > 0) {
    const [defensePos] = threats.openFours;
    if (defensePos) {
      // 黒番で防御位置が禁手の場合は通常探索に任せる
      const isBlack = color === "black";
      if (isBlack) {
        const forbiddenResult = checkForbiddenMoveWithCache(
          board,
          defensePos.row,
          defensePos.col,
        );
        if (forbiddenResult.isForbidden) {
          // 禁手追い込み: 防御できないので通常探索で禁手以外の手を選ぶ
          // （どうせ負けるが、禁手を打つよりマシ）
        } else {
          return {
            position: defensePos,
            score: -PATTERN_SCORES.FIVE, // 負け確定
            completedDepth: 0,
            interrupted: false,
            elapsedTime: performance.now() - startTime,
            stats: mergeProfilingCounters(ctx.stats),
          };
        }
      } else {
        return {
          position: defensePos,
          score: -PATTERN_SCORES.FIVE, // 負け確定
          completedDepth: 0,
          interrupted: false,
          elapsedTime: performance.now() - startTime,
          stats: mergeProfilingCounters(ctx.stats),
        };
      }
    }
  }

  // 相手の止め四があれば止める（止めないと負け）
  // 四三の場合も、まず四を止める（どうせ負けだが）
  if (threats.fours.length > 0) {
    const [defensePos] = threats.fours;
    if (defensePos) {
      // 黒番で防御位置が禁手の場合は通常探索に任せる
      const isBlack = color === "black";
      if (isBlack) {
        const forbiddenResult = checkForbiddenMoveWithCache(
          board,
          defensePos.row,
          defensePos.col,
        );
        if (forbiddenResult.isForbidden) {
          // 禁手追い込み: 防御できないので通常探索で禁手以外の手を選ぶ
          // （どうせ負けるが、禁手を打つよりマシ）
        } else {
          return {
            position: defensePos,
            score: threats.openThrees.length > 0 ? -PATTERN_SCORES.FIVE : 0,
            completedDepth: 0,
            interrupted: false,
            elapsedTime: performance.now() - startTime,
            stats: mergeProfilingCounters(ctx.stats),
          };
        }
      } else {
        return {
          position: defensePos,
          score: threats.openThrees.length > 0 ? -PATTERN_SCORES.FIVE : 0,
          completedDepth: 0,
          interrupted: false,
          elapsedTime: performance.now() - startTime,
          stats: mergeProfilingCounters(ctx.stats),
        };
      }
    }
  }

  // 相手VCF結果（VCFレース判定 + Mise-VCFスキップ + 防御候補制限で共有）
  // NOTE: 各VCFは独立に探索するため、手順の相互干渉は考慮しない
  // 3状態: undefined=未探索、null=探索済みVCFなし、VCFSequenceResult=VCFあり
  let opponentVCFResult: VCFSequenceResult | null | undefined = undefined;

  // 3. 四追い勝ち（VCF）があれば即座にその手を返す
  // （相手の四がある場合は上記で即return済みなのでここには到達しない）
  const vcfResult = findVCFSequence(board, color);
  if (vcfResult) {
    // findVCFSequence が返す VCF は各防御手の counter-four/counter-five チェック済み。
    // 相手は毎手四を止めるしかないため、相手VCFの有無・長短に関係なく勝利確定。
    return {
      position: vcfResult.firstMove,
      score: PATTERN_SCORES.FIVE, // 勝利確定
      completedDepth: 0,
      interrupted: false,
      elapsedTime: performance.now() - startTime,
      stats: mergeProfilingCounters(ctx.stats),
    };
  }

  // 3.5 Mise-VCF（ミセ→強制応手→VCF勝ち）があれば即座にその手を返す
  // 自VCFがなかった場合、Mise-VCFの前に相手VCFを探索
  if (opponentVCFResult === undefined) {
    opponentVCFResult = findVCFSequence(board, opponentColor, {
      timeLimit: 100,
    });
  }

  // 相手VCFがある場合、Mise-VCFは間に合わない（最低2手+VCF手数が必要）のでスキップ
  if (!opponentVCFResult) {
    const miseVcfMove = findMiseVCFMove(board, color, {
      vcfOptions: { maxDepth: 12, timeLimit: 300 },
      timeLimit: 500,
    });
    if (miseVcfMove) {
      const isForbidden =
        color === "black" &&
        checkForbiddenMoveWithCache(board, miseVcfMove.row, miseVcfMove.col)
          .isForbidden;
      if (!isForbidden) {
        return {
          position: miseVcfMove,
          score: PATTERN_SCORES.FIVE, // 勝利確定
          completedDepth: 0,
          interrupted: false,
          elapsedTime: performance.now() - startTime,
          stats: mergeProfilingCounters(ctx.stats),
        };
      }
      // 禁手の場合はMise-VCFなしとして通常探索にフォールスルー
    }
  }

  // 4. 相手のVCF（四追い勝ち）があれば候補手を防御手に制限
  // 相手VCF結果を共有変数から取得（重複探索を排除）
  const opponentVCFMove = opponentVCFResult?.firstMove ?? null;
  let vcfDefenseSet: Set<string> | null = null;
  if (opponentVCFMove) {
    vcfDefenseSet = new Set<string>();

    // (a) カウンターフォー: 自分の四を作れる手（相手はVCFを中断して応手が必要）
    const counterFours = findFourMoves(board, color);
    for (const m of counterFours) {
      vcfDefenseSet.add(`${m.row},${m.col}`);
    }

    // (b) ブロック: 相手VCF開始手をシミュレートし、四の防御位置を取得
    const vcfRow = board[opponentVCFMove.row];
    if (vcfRow) {
      vcfRow[opponentVCFMove.col] = opponentColor;
      const blockPos = getFourDefensePosition(
        board,
        opponentVCFMove,
        opponentColor,
      );
      vcfRow[opponentVCFMove.col] = null;

      if (blockPos) {
        vcfDefenseSet.add(`${blockPos.row},${blockPos.col}`);
      }
    }
  }

  // =========================================================================
  // 通常の探索
  // =========================================================================

  // 候補手を生成
  let moves = generateSortedMoves(board, color, {
    ttMove: null,
    killers: ctx.killers,
    depth: 1,
    history: ctx.history,
    useStaticEval: true,
    evaluationOptions,
  });

  // 相手のVCF防御が活三防御より優先
  if (vcfDefenseSet && vcfDefenseSet.size > 0) {
    const vcfSet = vcfDefenseSet;
    const defenseMoves = moves.filter((m) => vcfSet.has(`${m.row},${m.col}`));
    if (defenseMoves.length > 0) {
      moves = defenseMoves;
    }
  } else if (threats.openThrees.length > 0) {
    // 相手の活三があれば、防御位置のみを候補として探索
    // （どの止め方がいいかは探索で決める）
    const defenseSet = new Set(
      threats.openThrees.map((p) => `${p.row},${p.col}`),
    );
    const defenseMoves = moves.filter((m) =>
      defenseSet.has(`${m.row},${m.col}`),
    );
    // 防御位置が候補手に含まれていれば、それらのみを探索
    if (defenseMoves.length > 0) {
      moves = defenseMoves;
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
