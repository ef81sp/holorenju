/**
 * Quiescence Search（静止探索）
 *
 * 末端ノード（depth=0）で脅威手（四・ブロック）が未解決の場合、
 * これらを追加探索して「静止した状態」で評価する。
 * 水平線効果（四+ブロックの空のやり取りでスコアが膨らむ問題）を軽減する。
 */

import type { BoardState, Position } from "@/types/game";

import type { SearchContext } from "./context";

import {
  applyMoveInPlace,
  getOppositeColor,
  undoMove,
} from "../core/boardUtils";
import { evaluateBoard } from "../evaluation/boardEvaluation";
import { placeStone, removeStone } from "../lineTable/lineTable";
import { isNearExistingStone } from "../moveGenerator";
import { updateHash } from "../zobrist";
import { createsFour } from "./threatMoves";
import { getFourDefensePosition } from "./threatPatterns";

/** Quiescence Search の最大深度（四+ブロック 2往復分） */
export const MAX_QUIESCENCE_DEPTH = 4;

/**
 * 脅威手（四を作る手 + 相手の四へのブロック）を生成
 *
 * 1. 相手の直前手が四を作っていれば → ブロック手のみ返す（強制応答）
 * 2. そうでなければ → 自分が四を作れる手を列挙
 */
export function generateTacticalMoves(
  board: BoardState,
  color: "black" | "white",
  lastMove: Position | null,
): Position[] {
  const opponentColor = getOppositeColor(color);

  // 1. 相手の直前手が四を作っていれば → ブロック手のみ
  if (lastMove) {
    const defensePos = getFourDefensePosition(board, lastMove, opponentColor);
    if (defensePos) {
      return [defensePos];
    }
  }

  // 2. 自分が四を作れる手を列挙
  const moves: Position[] = [];
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r]?.[c] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, r, c, 1)) {
        continue;
      }
      if (createsFour(board, r, c, color)) {
        moves.push({ row: r, col: c });
      }
    }
  }
  return moves;
}

/**
 * Quiescence Search（静止探索）
 *
 * depth=0 の末端ノードで、脅威手（四・ブロック）を追加探索し、
 * 「静止した状態」で evaluateBoard を呼ぶ。
 *
 * Stand-pat パターン: まず「何もしない」場合のスコアを計算し、
 * alpha-beta カットオフを試みる。脅威手がなければそのまま返す。
 */
export function quiescenceSearch(
  board: BoardState,
  hash: bigint,
  isMaximizing: boolean,
  perspective: "black" | "white",
  alphaInit: number,
  betaInit: number,
  lastMove: Position | null,
  ctx: SearchContext,
  qDepth: number,
): number {
  ctx.stats.nodes++;

  const currentColor = isMaximizing
    ? perspective
    : getOppositeColor(perspective);
  const evalOptions = {
    singleFourPenaltyMultiplier:
      ctx.evaluationOptions.singleFourPenaltyMultiplier,
    lastMoverIsPerspective: !isMaximizing,
    enableLeafMise: ctx.evaluationOptions.enableMise,
  };

  // 時間/ノード制限チェック
  if (ctx.timeoutFlag || ctx.nodeCountExceeded) {
    return evaluateBoard(board, perspective, evalOptions, ctx.lineTable);
  }

  // Stand-pat: 何もしない場合の評価
  const standPat = evaluateBoard(
    board,
    perspective,
    evalOptions,
    ctx.lineTable,
  );

  let alpha = alphaInit;
  let beta = betaInit;

  // Alpha-beta cutoff（stand-pat）
  if (isMaximizing) {
    if (standPat >= beta) {
      return beta;
    }
    if (standPat > alpha) {
      alpha = standPat;
    }
  } else {
    if (standPat <= alpha) {
      return alpha;
    }
    if (standPat < beta) {
      beta = standPat;
    }
  }

  // 深度制限
  if (qDepth <= 0) {
    return standPat;
  }

  // 脅威手生成
  const moves = generateTacticalMoves(board, currentColor, lastMove);
  if (moves.length === 0) {
    return standPat;
  }

  let bestScore = standPat;

  for (const move of moves) {
    // 石を配置 + LineTable同期
    applyMoveInPlace(board, move, currentColor);
    if (ctx.lineTable) {
      placeStone(ctx.lineTable, move.row, move.col, currentColor);
    }
    const newHash = updateHash(hash, move.row, move.col, currentColor);

    const score = quiescenceSearch(
      board,
      newHash,
      !isMaximizing,
      perspective,
      alpha,
      beta,
      move,
      ctx,
      qDepth - 1,
    );

    // 石を除去 + LineTable同期
    undoMove(board, move);
    if (ctx.lineTable) {
      removeStone(ctx.lineTable, move.row, move.col, currentColor);
    }

    // Alpha-beta更新
    if (isMaximizing) {
      if (score > bestScore) {
        bestScore = score;
      }
      if (score > alpha) {
        alpha = score;
      }
      if (alpha >= beta) {
        break;
      }
    } else {
      if (score < bestScore) {
        bestScore = score;
      }
      if (score < beta) {
        beta = score;
      }
      if (alpha >= beta) {
        break;
      }
    }
  }

  // TT保存: 負の可変depthで本探索と分離
  const ttDepth = -(MAX_QUIESCENCE_DEPTH - qDepth + 1);
  let scoreType: "EXACT" | "LOWER_BOUND" | "UPPER_BOUND" = "EXACT";
  if (bestScore <= alphaInit) {
    scoreType = "UPPER_BOUND";
  } else if (bestScore >= betaInit) {
    scoreType = "LOWER_BOUND";
  }
  ctx.tt.store(hash, bestScore, ttDepth, scoreType, null);

  return bestScore;
}
