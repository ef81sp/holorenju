/**
 * Minimax + Alpha-Beta剪定
 *
 * 「相手は最善手を打つ」と仮定し、数手先を読んで最良の手を選ぶ
 */

import type { BoardState, Position, StoneColor } from "@/types/game";

import { checkWin } from "@/logic/renjuRules";

import { applyMove, countStones, getOppositeColor } from "../core/boardUtils";
import {
  DEFAULT_EVAL_OPTIONS,
  detectOpponentThreats,
  evaluateBoard,
  evaluatePosition,
  PATTERN_SCORES,
  type EvaluationOptions,
} from "../evaluation";
import {
  createHistoryTable,
  createKillerMoves,
  generateMoves,
  generateSortedMoves,
  recordKillerMove,
  updateHistory,
  type HistoryTable,
  type KillerMoves,
} from "../moveGenerator";
import {
  globalTT,
  TranspositionTable,
  type ScoreType,
} from "../transpositionTable";
import { computeBoardHash, updateHash } from "../zobrist";
import { findVCFMove } from "./vcf";

/** 無限大の代わりに使う大きな値 */
const INFINITY = 1000000;

// =============================================================================
// 動的時間配分
// =============================================================================

/**
 * 動的時間配分の計算
 *
 * @param baseTimeLimit 基本時間制限（ms）
 * @param board 盤面
 * @param moveCount 候補手の数
 * @returns 調整後の時間制限（ms）
 */
function calculateDynamicTimeLimit(
  baseTimeLimit: number,
  board: BoardState,
  moveCount: number,
): number {
  // 唯一の候補手なら即座に返す
  if (moveCount <= 1) {
    return 0;
  }

  const stones = countStones(board);

  // 序盤（6手以下）: 時間を短縮
  if (stones <= 6) {
    return Math.floor(baseTimeLimit * 0.5);
  }

  // 候補手が少ない（緊急手の可能性）: 時間を短縮
  if (moveCount <= 3) {
    return Math.floor(baseTimeLimit * 0.3);
  }

  // 通常
  return baseTimeLimit;
}

// =============================================================================
// LMR (Late Move Reductions) パラメータ
// =============================================================================

/** LMRを適用する候補手のインデックス閾値（この値以上のインデックスで適用） */
const LMR_MOVE_THRESHOLD = 4;

/** LMRを適用する最小探索深度 */
const LMR_MIN_DEPTH = 3;

/** LMRによる探索深度の削減量 */
const LMR_REDUCTION = 1;

// =============================================================================
// Aspiration Windows パラメータ
// =============================================================================

/** Aspiration Windowの初期幅 */
const ASPIRATION_WINDOW = 50;

/**
 * 候補手のスコア情報
 */
export interface MoveScoreEntry {
  /** 着手位置 */
  move: Position;
  /** 評価スコア */
  score: number;
}

/**
 * ランダム選択情報
 */
export interface RandomSelectionResult {
  /** ランダム選択が発生したか */
  wasRandom: boolean;
  /** 選択された手の元の順位（1始まり） */
  originalRank: number;
  /** 選択対象の候補数 */
  candidateCount: number;
}

/**
 * Minimax探索結果
 */
export interface MinimaxResult {
  /** 最善手の位置 */
  position: Position;
  /** 評価スコア */
  score: number;
  /** 候補手のスコアリスト（ソート済み） */
  candidates?: MoveScoreEntry[];
  /** ランダム選択情報 */
  randomSelection?: RandomSelectionResult;
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
 * @returns 最善手と評価スコア
 */
export function findBestMove(
  board: BoardState,
  color: "black" | "white",
  depth: number,
  randomFactor = 0,
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
    // 上位N手からランダムに選択（Nは候補数の1/3程度）
    const topN = Math.max(2, Math.floor(moveScores.length / 3));
    const randomIndex = Math.floor(Math.random() * topN);
    const selected = moveScores[randomIndex];
    if (selected) {
      return {
        position: selected.move,
        score: selected.score,
      };
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
 * 深度別の最善手情報
 */
export interface DepthHistoryEntry {
  /** 探索深度 */
  depth: number;
  /** 最善手の位置 */
  position: Position;
  /** 評価スコア */
  score: number;
}

/**
 * Iterative Deepening結果
 */
export interface IterativeDeepingResult extends MinimaxResult {
  /** 実際に完了した探索深度 */
  completedDepth: number;
  /** 時間切れで中断したか */
  interrupted: boolean;
  /** 経過時間（ミリ秒） */
  elapsedTime: number;
  /** 深度別の最善手履歴 */
  depthHistory?: DepthHistoryEntry[];
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
 * @returns 最善手と探索情報
 */
export function findBestMoveIterative(
  board: BoardState,
  color: "black" | "white",
  maxDepth: number,
  timeLimit: number,
  randomFactor = 0,
): IterativeDeepingResult {
  const startTime = performance.now();

  // 初期結果（深さ1で必ず結果を得る）
  let bestResult = findBestMove(board, color, 1, randomFactor);
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
    const result = findBestMove(board, color, depth, randomFactor);

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
 * 探索コンテキスト
 *
 * 探索中に使用するデータ構造を一元管理
 */
export interface SearchContext {
  /** Transposition Table */
  tt: TranspositionTable;
  /** History Table */
  history: HistoryTable;
  /** Killer Moves */
  killers: KillerMoves;
  /** 探索統計 */
  stats: SearchStats;
  /** 評価オプション */
  evaluationOptions: EvaluationOptions;
  /** 探索開始時刻（時間制限用） */
  startTime?: number;
  /** 時間制限（ミリ秒） */
  timeLimit?: number;
  /** 時間切れフラグ */
  timeoutFlag?: boolean;
  /** ノード数上限 */
  maxNodes?: number;
  /** ノード数上限超過フラグ */
  nodeCountExceeded?: boolean;
}

/**
 * 探索統計
 */
export interface SearchStats {
  /** 探索ノード数 */
  nodes: number;
  /** TTヒット数 */
  ttHits: number;
  /** TTカットオフ数 */
  ttCutoffs: number;
  /** Beta剪定数 */
  betaCutoffs: number;
}

/**
 * SearchContextを作成
 */
export function createSearchContext(
  tt: TranspositionTable = globalTT,
  evaluationOptions: EvaluationOptions = DEFAULT_EVAL_OPTIONS,
): SearchContext {
  return {
    tt,
    history: createHistoryTable(),
    killers: createKillerMoves(),
    stats: {
      nodes: 0,
      ttHits: 0,
      ttCutoffs: 0,
      betaCutoffs: 0,
    },
    evaluationOptions,
  };
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
  if (
    !ctx.timeoutFlag &&
    ctx.startTime !== undefined &&
    ctx.timeLimit !== undefined &&
    (ctx.stats.nodes & 0x7) === 0 // 8ノードごとにチェック（ビット演算で高速化）
  ) {
    const elapsed = performance.now() - ctx.startTime;
    if (elapsed >= ctx.timeLimit) {
      ctx.timeoutFlag = true;
    }
  }

  // 時間切れまたはノード数上限なら即座に現在の評価を返す
  if (ctx.timeoutFlag || ctx.nodeCountExceeded) {
    return evaluateBoard(board, perspective);
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
    const score = evaluateBoard(board, perspective);
    ctx.tt.store(hash, score, depth, "EXACT", null);
    return score;
  }

  // ソート済み候補手生成
  const moves = generateSortedMoves(board, currentColor, {
    ttMove,
    killers: ctx.killers,
    depth,
    history: ctx.history,
    useStaticEval: true,
    evaluationOptions: ctx.evaluationOptions,
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

    const newBoard = applyMove(board, move, currentColor);
    const newHash = updateHash(hash, move.row, move.col, currentColor);

    let score = 0;

    // LMR (Late Move Reductions)
    // 後半の候補手は浅く探索し、有望なら再探索
    const canApplyLMR =
      moveIndex >= LMR_MOVE_THRESHOLD &&
      depth >= LMR_MIN_DEPTH &&
      bestScore > -PATTERN_SCORES.FIVE + 1000; // 負けが確定していない

    if (canApplyLMR) {
      // 浅い探索
      score = minimaxWithTT(
        newBoard,
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
          newBoard,
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
        newBoard,
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
 * Aspiration Windows用オプション
 */
interface AspirationOptions {
  /** 前回のスコア（Aspiration Windowsの中心） */
  previousScore?: number;
  /** ウィンドウ幅 */
  windowSize?: number;
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
    // タイムアウトチェック
    if (ctx.timeoutFlag) {
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

    moveScores.push({ move, score });
    alpha = Math.max(alpha, score);
  }

  moveScores.sort((a, b) => b.score - a.score);

  // ランダム要素を適用
  if (
    randomFactor > 0 &&
    Math.random() < randomFactor &&
    moveScores.length > 1
  ) {
    const topN = Math.max(2, Math.floor(moveScores.length / 3));
    const randomIndex = Math.floor(Math.random() * topN);
    const selected = moveScores[randomIndex];
    if (selected) {
      return {
        position: selected.move,
        score: selected.score,
        candidates: moveScores,
        randomSelection: {
          wasRandom: true,
          originalRank: randomIndex + 1,
          candidateCount: topN,
        },
        ctx,
      };
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
): IterativeDeepingResult & { stats: SearchStats } {
  const startTime = performance.now();
  const ctx = createSearchContext(globalTT, evaluationOptions);

  // 新しい探索開始
  ctx.tt.newGeneration();

  // =========================================================================
  // 必須手の事前チェック（探索より優先）
  // =========================================================================

  // 1. 四追い勝ち（VCF）があれば即座にその手を返す
  const vcfMove = findVCFMove(board, color);
  if (vcfMove) {
    return {
      position: vcfMove,
      score: PATTERN_SCORES.FIVE, // 勝利確定
      completedDepth: 0,
      interrupted: false,
      elapsedTime: performance.now() - startTime,
      stats: ctx.stats,
    };
  }

  // 2. 相手の脅威（活四・止め四・活三）をチェック
  const opponentColor = color === "black" ? "white" : "black";
  const threats = detectOpponentThreats(board, opponentColor);

  // 相手の活四があれば止める（実際には止められないが）
  if (threats.openFours.length > 0) {
    const defensePos = threats.openFours[0];
    if (defensePos) {
      return {
        position: defensePos,
        score: -PATTERN_SCORES.FIVE, // 負け確定
        completedDepth: 0,
        interrupted: false,
        elapsedTime: performance.now() - startTime,
        stats: ctx.stats,
      };
    }
  }

  // 相手の止め四があれば止める（止めないと負け）
  // 四三の場合も、まず四を止める（どうせ負けだが）
  if (threats.fours.length > 0) {
    const defensePos = threats.fours[0];
    if (defensePos) {
      return {
        position: defensePos,
        score: threats.openThrees.length > 0 ? -PATTERN_SCORES.FIVE : 0, // 四三なら負け
        completedDepth: 0,
        interrupted: false,
        elapsedTime: performance.now() - startTime,
        stats: ctx.stats,
      };
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

  // 相手の活三があれば、防御位置のみを候補として探索
  // （どの止め方がいいかは探索で決める）
  if (threats.openThrees.length > 0) {
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

  const dynamicTimeLimit = calculateDynamicTimeLimit(
    timeLimit,
    board,
    moves.length,
  );

  // 時間制限情報をコンテキストに設定
  ctx.startTime = startTime;
  ctx.timeLimit = dynamicTimeLimit;
  ctx.timeoutFlag = false;

  // ノード数上限を設定
  ctx.maxNodes = maxNodes;
  ctx.nodeCountExceeded = false;

  // NOTE: Phase 6の最適化（precomputedThreats）は一旦無効化
  // 理由: 深いノードでは手番が変わるため、ルートノードで計算した脅威情報が
  // 不適切に使われる問題がある。毎回detectOpponentThreatsを呼ぶようにする。
  // 将来的には、ルートノードの候補手評価にのみ適用する形で最適化可能。

  // 唯一の候補手なら即座に返す
  if (moves.length === 1 && moves[0]) {
    return {
      position: moves[0],
      score: evaluatePosition(
        board,
        moves[0].row,
        moves[0].col,
        color,
        evaluationOptions,
      ),
      completedDepth: 0,
      interrupted: false,
      elapsedTime: performance.now() - startTime,
      stats: ctx.stats,
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
  for (let depth = 2; depth <= maxDepth; depth++) {
    const elapsedTime = performance.now() - startTime;

    // 動的時間制限チェック（探索開始前）
    if (
      elapsedTime > dynamicTimeLimit * 0.5 ||
      ctx.timeoutFlag ||
      ctx.nodeCountExceeded
    ) {
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
    );

    // 探索中にタイムアウトまたはノード数上限に達した場合は前の結果を使用
    if (ctx.timeoutFlag || ctx.nodeCountExceeded) {
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
      );

      // 再探索中にタイムアウトまたはノード数上限に達した場合
      if (ctx.timeoutFlag || ctx.nodeCountExceeded) {
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

    const currentTime = performance.now() - startTime;
    if (currentTime >= dynamicTimeLimit) {
      bestResult = result;
      completedDepth = depth;
      interrupted = true;
      break;
    }

    bestResult = result;
    completedDepth = depth;
  }

  return {
    position: bestResult.position,
    score: bestResult.score,
    candidates: bestResult.candidates,
    randomSelection: bestResult.randomSelection,
    completedDepth,
    interrupted,
    elapsedTime: performance.now() - startTime,
    depthHistory,
    stats: ctx.stats,
  };
}
