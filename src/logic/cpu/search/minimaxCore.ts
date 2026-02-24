/**
 * Minimax探索コア（TT/Move Ordering統合版）
 *
 * Transposition Table、Killer Move、History Heuristicを使用した
 * 高速なMinimax + Alpha-Beta探索。
 */

import type { BoardState, Position } from "@/types/game";

import { checkFive, checkWin } from "@/logic/renjuRules";

import type { ScoreType } from "../transpositionTable";

import {
  checkForbiddenMoveWithCache,
  setCurrentBoardHash,
} from "../cache/forbiddenCache";
import {
  applyMove,
  applyMoveInPlace,
  getOppositeColor,
  undoMove,
} from "../core/boardUtils";
import { evaluateBoard } from "../evaluation/boardEvaluation";
import { PATTERN_SCORES } from "../evaluation/patternScores";
import { evaluatePosition } from "../evaluation/positionEvaluation";
import { placeStone, removeStone } from "../lineTable/lineTable";
import {
  generateSortedMoves,
  recordKillerMove,
  updateHistory,
} from "../moveGenerator";
import { computeBoardHash, updateHash } from "../zobrist";
import { createSearchContext, type SearchContext } from "./context";
import { isMeasuringFutility, recordFutilityGain } from "./futilityMeasurement";
import { extractPV, type MinimaxResult, type MoveScoreEntry } from "./results";
import {
  ASPIRATION_WINDOW,
  FUTILITY_MARGINS_OPPONENT,
  FUTILITY_MARGINS_SELF,
  hasImmediateThreat,
  INFINITY,
  LMR_MIN_DEPTH,
  LMR_MOVE_THRESHOLD,
  LMR_REDUCTION,
  NMP_MIN_DEPTH,
  NMP_REDUCTION,
} from "./techniques";

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
  color: "black" | "white",
): boolean {
  if (!lastMove || !color) {
    return false;
  }
  return checkWin(board, lastMove, color);
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
    return evaluateBoard(
      board,
      perspective,
      {
        singleFourPenaltyMultiplier:
          ctx.evaluationOptions.singleFourPenaltyMultiplier,
      },
      ctx.lineTable,
    );
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
    const score = evaluateBoard(
      board,
      perspective,
      {
        singleFourPenaltyMultiplier:
          ctx.evaluationOptions.singleFourPenaltyMultiplier,
      },
      ctx.lineTable,
    );
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
      null, // NMPでは手を打たないため、lastMoveをnullにして偽の終端判定を防止
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
    let futilityMeasureStaticEval: number | undefined = undefined;
    if (
      isMeasuringFutility() &&
      depth >= 1 &&
      depth <= 4 &&
      moveIndex > 0 &&
      bestScore > -PATTERN_SCORES.FIVE + 5000 &&
      bestScore < PATTERN_SCORES.FIVE - 5000
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
      bestScore < PATTERN_SCORES.FIVE - 5000
    ) {
      const futilityMargins = isMaximizing
        ? FUTILITY_MARGINS_SELF
        : FUTILITY_MARGINS_OPPONENT;
      const futilityMargin = futilityMargins[depth] ?? 0;
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

    const canApplyLMR =
      moveIndex >= LMR_MOVE_THRESHOLD &&
      depth >= LMR_MIN_DEPTH &&
      bestScore > -PATTERN_SCORES.FIVE + 1000; // 負けが確定していない

    // 石を配置（インプレース変更）
    applyMoveInPlace(board, move, currentColor);
    if (ctx.lineTable) {
      placeStone(ctx.lineTable, move.row, move.col, currentColor);
    }
    const newHash = updateHash(hash, move.row, move.col, currentColor);

    // 禁手キャッシュ用に現在の盤面ハッシュを更新
    setCurrentBoardHash(newHash);

    let score = 0;

    // LMR (Late Move Reductions)
    // 後半の候補手は浅く探索し、有望なら再探索
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
    if (ctx.lineTable) {
      removeStone(ctx.lineTable, move.row, move.col, currentColor);
    }

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

    // LineTable を同期（ルート探索はコピー盤面だがLineTableは共有）
    if (ctx.lineTable) {
      placeStone(ctx.lineTable, move.row, move.col, color);
    }

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

    if (ctx.lineTable) {
      removeStone(ctx.lineTable, move.row, move.col, color);
    }

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
            wasTieBreak: false,
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

  // 同スコア手のタイブレーク
  const bestScore = best.score;
  const tiedMoves = moveScores.filter((m) => m.score === bestScore);
  if (tiedMoves.length > 1) {
    const tieIndex = Math.floor(Math.random() * tiedMoves.length);
    const selected = tiedMoves[tieIndex] ?? best;
    const originalRank =
      moveScores.findIndex((m) => m.move === selected.move) + 1;
    return {
      position: selected.move,
      score: selected.score,
      candidates: moveScores,
      randomSelection: {
        wasRandom: false,
        wasTieBreak: true,
        originalRank,
        candidateCount: tiedMoves.length,
      },
      ctx,
    };
  }

  return {
    position: best.move,
    score: best.score,
    candidates: moveScores,
    randomSelection: {
      wasRandom: false,
      wasTieBreak: false,
      originalRank: 1,
      candidateCount: moveScores.length,
    },
    ctx,
  };
}
