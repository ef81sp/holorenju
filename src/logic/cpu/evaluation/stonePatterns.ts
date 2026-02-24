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
import {
  END_STATE_FROM_CODE,
  PACKED_TO_SCORE,
  PACKED_TO_TYPE,
  TYPE_FOUR,
  TYPE_OPEN_THREE,
} from "../lineTable/lineScan";
import { getPatternScore, getPatternType } from "./directionAnalysis";
import { analyzeJumpPatterns, getJumpPatternScore } from "./jumpPatterns";
import {
  type DirectionPattern,
  type EndState,
  emptyPatternBreakdown,
  type PatternBreakdown,
  type PatternType,
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
 * evaluateBoard 用の軽量版石パターン評価
 *
 * PatternBreakdown の7オブジェクト生成を回避し、
 * evaluateBoard が必要とする4つのプリミティブ値のみを返す。
 */
export function evaluateStonePatternsLight(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
  lineTable?: LineTable,
): {
  score: number;
  fourScore: number;
  openThreeScore: number;
  activeDirectionCount: number;
} {
  let score = 0;
  let fourScore = 0;
  let openThreeScore = 0;
  let activeDirectionCount = 0;
  const precomputed: DirectionPattern[] = [];

  for (let i = 0; i < DIRECTIONS.length; i++) {
    const pattern = getDirectionPattern(board, row, col, i, color, lineTable);
    precomputed.push(pattern);
    const baseScore = getPatternScore(pattern);
    const patternType: PatternType = getPatternType(pattern);

    if (baseScore > 0) {
      activeDirectionCount++;
    }

    const isDiagonal = i === 2 || i === 3;
    let finalScore = baseScore;
    if (isDiagonal && baseScore > 0) {
      finalScore = Math.round(
        baseScore * PATTERN_SCORES.DIAGONAL_BONUS_MULTIPLIER,
      );
    }

    score += finalScore;

    if (patternType === "four") {
      fourScore += finalScore;
    } else if (patternType === "openThree") {
      openThreeScore += finalScore;
    }
  }

  const jumpResult = analyzeJumpPatterns(board, row, col, color, precomputed);
  score += getJumpPatternScore(jumpResult);

  if (jumpResult.jumpFourCount > 0) {
    fourScore += PATTERN_SCORES.FOUR * jumpResult.jumpFourCount;
  }
  if (jumpResult.hasValidOpenThree) {
    openThreeScore += PATTERN_SCORES.OPEN_THREE;
  }

  return { score, fourScore, openThreeScore, activeDirectionCount };
}

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

const END_STATE_TABLE: EndState[] = END_STATE_FROM_CODE;

/**
 * 事前計算データから石パターンスコアを算出
 *
 * evaluateStonePatternsLight の precomputed 版。
 * CELL_LINES_FLAT lookup + analyzeLinePattern 呼び出しを
 * PACKED_TO_SCORE/TYPE 配列参照に置換。
 */
export function evaluateStonePatternsPrecomputed(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
  packedPatterns: Uint8Array,
): {
  score: number;
  fourScore: number;
  openThreeScore: number;
  activeDirectionCount: number;
} {
  const cellIndex = row * 15 + col;
  const base = cellIndex * 4;
  let score = 0;
  let fourScore = 0;
  let openThreeScore = 0;
  let activeDirectionCount = 0;

  const patterns: DirectionPattern[] = [];

  for (let dir = 0; dir < 4; dir++) {
    const packed = packedPatterns[base + dir] ?? 0;
    const count = packed >> 4;
    const end1Code = (packed >> 2) & 3;
    const end2Code = packed & 3;

    patterns.push({
      count: count === 0 ? 1 : count,
      end1: count === 0 ? "edge" : (END_STATE_TABLE[end1Code] ?? "edge"),
      end2: count === 0 ? "edge" : (END_STATE_TABLE[end2Code] ?? "edge"),
    });

    const baseScore = PACKED_TO_SCORE[packed] ?? 0;
    const type = PACKED_TO_TYPE[packed] ?? 0;

    if (baseScore > 0) {
      activeDirectionCount++;
    }

    let finalScore = baseScore;
    if ((dir === 2 || dir === 3) && baseScore > 0) {
      finalScore = Math.round(
        baseScore * PATTERN_SCORES.DIAGONAL_BONUS_MULTIPLIER,
      );
    }

    score += finalScore;
    if (type === TYPE_FOUR) {
      fourScore += finalScore;
    } else if (type === TYPE_OPEN_THREE) {
      openThreeScore += finalScore;
    }
  }

  // 跳びパターン（board アクセスが必要、precomputed では代替不可）
  const jumpResult = analyzeJumpPatterns(board, row, col, color, patterns);
  score += getJumpPatternScore(jumpResult);
  if (jumpResult.jumpFourCount > 0) {
    fourScore += PATTERN_SCORES.FOUR * jumpResult.jumpFourCount;
  }
  if (jumpResult.hasValidOpenThree) {
    openThreeScore += PATTERN_SCORES.OPEN_THREE;
  }

  return { score, fourScore, openThreeScore, activeDirectionCount };
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
