/**
 * 石パターン評価関数
 *
 * 指定位置の石について全方向のパターンスコアを計算
 * 連続パターンと跳びパターンの両方を評価
 */

import type { BoardState } from "@/types/game";

import type { LineTable } from "../lineTable/lineTable";

import { DIRECTIONS } from "../core/constants";
import { getDirectionPattern } from "../lineTable/adapter";
import { getPatternScore, getPatternType } from "./directionAnalysis";
import { analyzeJumpPatterns, getJumpPatternScore } from "./jumpPatterns";
import {
  type DirectionPattern,
  emptyPatternBreakdown,
  type PatternBreakdown,
  PATTERN_SCORES,
} from "./patternScores";

/**
 * 指定位置の石について全方向のパターンスコアを計算
 * 連続パターンと跳びパターンの両方を評価
 *
 * @param board 盤面
 * @param row 行
 * @param col 列
 * @param color 石の色
 * @returns 全方向のスコア合計
 */
export function evaluateStonePatterns(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
  lineTable?: LineTable,
): number {
  let score = 0;
  const precomputed: DirectionPattern[] = [];

  // 連続パターンのスコア
  // DIRECTIONSのインデックス: 0=横, 1=縦, 2=右下斜め, 3=右上斜め
  for (let i = 0; i < DIRECTIONS.length; i++) {
    const pattern = getDirectionPattern(board, row, col, i, color, lineTable);
    precomputed.push(pattern);
    let dirScore = getPatternScore(pattern);

    // 斜め方向（インデックス2,3）にボーナスを適用
    if ((i === 2 || i === 3) && dirScore > 0) {
      dirScore = Math.round(
        dirScore * PATTERN_SCORES.DIAGONAL_BONUS_MULTIPLIER,
      );
    }

    score += dirScore;
  }

  // 跳びパターンのスコア（precomputed で重複 analyzeDirection を排除）
  const jumpResult = analyzeJumpPatterns(board, row, col, color, precomputed);
  score += getJumpPatternScore(jumpResult);

  return score;
}

/**
 * 石のパターンを評価し、内訳も返す
 */
export function evaluateStonePatternsWithBreakdown(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
  lineTable?: LineTable,
): {
  score: number;
  breakdown: PatternBreakdown;
  activeDirectionCount: number;
} {
  let score = 0;
  const breakdown: PatternBreakdown = emptyPatternBreakdown();
  let activeDirectionCount = 0;
  const precomputed: DirectionPattern[] = [];

  // 連続パターンのスコア
  for (let i = 0; i < DIRECTIONS.length; i++) {
    const pattern = getDirectionPattern(board, row, col, i, color, lineTable);
    precomputed.push(pattern);
    const baseScore = getPatternScore(pattern);
    const patternType = getPatternType(pattern);

    if (baseScore > 0) {
      activeDirectionCount++;
    }

    // 斜め方向（インデックス2,3）にボーナスを適用
    const isDiagonal = i === 2 || i === 3;
    let finalScore = baseScore;
    let diagonalBonus = 0;

    if (isDiagonal && baseScore > 0) {
      finalScore = Math.round(
        baseScore * PATTERN_SCORES.DIAGONAL_BONUS_MULTIPLIER,
      );
      diagonalBonus = finalScore - baseScore;
    }

    score += finalScore;

    // 内訳に追加
    if (patternType) {
      breakdown[patternType].base += baseScore;
      breakdown[patternType].diagonalBonus += diagonalBonus;
      breakdown[patternType].final += finalScore;
    }
  }

  // 跳びパターンのスコア（precomputed で重複 analyzeDirection を排除）
  const jumpResult = analyzeJumpPatterns(board, row, col, color, precomputed);
  const jumpScore = getJumpPatternScore(jumpResult);
  score += jumpScore;

  // 跳び四は四に、跳び三は活三に加算（跳びパターンは斜めボーナスなし）
  if (jumpResult.jumpFourCount > 0) {
    const jumpFourScore = PATTERN_SCORES.FOUR * jumpResult.jumpFourCount;
    breakdown.four.base += jumpFourScore;
    breakdown.four.final += jumpFourScore;
  }
  if (jumpResult.hasValidOpenThree) {
    breakdown.openThree.base += PATTERN_SCORES.OPEN_THREE;
    breakdown.openThree.final += PATTERN_SCORES.OPEN_THREE;
  }

  return { score, breakdown, activeDirectionCount };
}
