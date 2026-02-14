/**
 * Simple Minimax + Alpha-Beta (TT非使用版)
 *
 * 基本的なMinimax探索アルゴリズム。テストやベンチマーク用。
 */

import type { BoardState, Position } from "@/types/game";

import { checkWin } from "@/logic/renjuRules";

import type { IterativeDeepingResult, MinimaxResult } from "./results";

import { applyMove, getOppositeColor } from "../core/boardUtils";
import { evaluateBoard } from "../evaluation/boardEvaluation";
import { PATTERN_SCORES } from "../evaluation/patternScores";
import { evaluatePosition } from "../evaluation/positionEvaluation";
import { generateMoves } from "../moveGenerator";
import { INFINITY } from "./techniques";

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

  // 同スコア手のタイブレーク
  const topScore = best.score;
  const tiedMoves = moveScores.filter((m) => m.score === topScore);
  if (tiedMoves.length > 1) {
    const tieIndex = Math.floor(Math.random() * tiedMoves.length);
    const selected = tiedMoves[tieIndex] ?? best;
    return {
      position: selected.move,
      score: selected.score,
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
