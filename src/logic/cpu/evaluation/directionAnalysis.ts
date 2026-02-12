/**
 * 方向パターン分析
 *
 * 連続石のカウントと端状態判定
 */

import type { BoardState } from "@/types/game";

import { isValidPosition } from "@/logic/renjuRules";

import {
  type DirectionPattern,
  type EndState,
  type PatternScoreDetail,
  type PatternType,
  PATTERN_SCORES,
} from "./patternScores";

/**
 * 指定方向に連続する同色石をカウントし、端の状態を確認
 *
 * @param board 盤面
 * @param row 起点行
 * @param col 起点列
 * @param dr 行方向
 * @param dc 列方向
 * @param color 石の色
 * @returns 連続数と端の状態
 */
export function countInDirection(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { count: number; endState: EndState } {
  let count = 0;
  let r = row + dr;
  let c = col + dc;

  // 同色石をカウント
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    count++;
    r += dr;
    c += dc;
  }

  // 端の状態を確認
  let endState: EndState = "opponent";
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    endState = "empty";
  } else if (!isValidPosition(r, c)) {
    endState = "edge";
  }

  return { count, endState };
}

/**
 * 指定位置から指定方向のパターンを分析
 *
 * @param board 盤面
 * @param row 起点行
 * @param col 起点列
 * @param dr 行方向
 * @param dc 列方向
 * @param color 石の色
 * @returns パターン分析結果
 */
export function analyzeDirection(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): DirectionPattern {
  // 正方向
  const pos = countInDirection(board, row, col, dr, dc, color);
  // 負方向
  const neg = countInDirection(board, row, col, -dr, -dc, color);

  return {
    count: pos.count + neg.count + 1, // +1は起点自身
    end1: pos.endState,
    end2: neg.endState,
  };
}

/**
 * パターンからスコアを計算
 *
 * @param pattern パターン分析結果
 * @returns スコア
 */
export function getPatternScore(pattern: DirectionPattern): number {
  const { count, end1, end2 } = pattern;
  const bothOpen = end1 === "empty" && end2 === "empty";
  const oneOpen = end1 === "empty" || end2 === "empty";

  switch (count) {
    case 5:
      return PATTERN_SCORES.FIVE;
    case 4:
      if (bothOpen) {
        return PATTERN_SCORES.OPEN_FOUR;
      }
      if (oneOpen) {
        return PATTERN_SCORES.FOUR;
      }
      return 0; // 両端塞がり
    case 3:
      if (bothOpen) {
        return PATTERN_SCORES.OPEN_THREE;
      }
      if (oneOpen) {
        return PATTERN_SCORES.THREE;
      }
      return 0;
    case 2:
      if (bothOpen) {
        return PATTERN_SCORES.OPEN_TWO;
      }
      if (oneOpen) {
        return PATTERN_SCORES.TWO;
      }
      return 0;
    default:
      // 6以上は長連（黒の禁手だが白には有利）
      if (count >= 6) {
        return PATTERN_SCORES.FIVE;
      }
      return 0;
  }
}

/**
 * 中央からの距離に基づくボーナスを計算
 * 中央（7,7）に近いほど高いスコア
 */
export function getCenterBonus(row: number, col: number): number {
  const centerRow = 7;
  const centerCol = 7;
  const distance = Math.abs(row - centerRow) + Math.abs(col - centerCol);
  // 最大距離は14（角から中央）、距離が近いほど高スコア
  return Math.round(
    Math.max(0, PATTERN_SCORES.CENTER_BONUS * (14 - distance)) / 14,
  );
}

/**
 * パターンタイプを取得
 */
export function getPatternType(pattern: DirectionPattern): PatternType {
  const { count, end1, end2 } = pattern;
  const bothOpen = end1 === "empty" && end2 === "empty";
  const oneOpen = end1 === "empty" || end2 === "empty";

  switch (count) {
    case 5:
      return "five";
    case 4:
      if (bothOpen) {
        return "openFour";
      }
      if (oneOpen) {
        return "four";
      }
      return null;
    case 3:
      if (bothOpen) {
        return "openThree";
      }
      if (oneOpen) {
        return "three";
      }
      return null;
    case 2:
      if (bothOpen) {
        return "openTwo";
      }
      if (oneOpen) {
        return "two";
      }
      return null;
    default:
      if (count >= 6) {
        return "five";
      }
      return null;
  }
}

/**
 * 脅威レベル別の防御倍率
 *
 * 先手脅威（four/openThree）は防御価値が高く、
 * 構築材料（three以下）は防御価値が低い。
 */
export const DEFENSE_MULTIPLIERS = {
  /** 五連: 止めなければ即負け */
  five: 1.0,
  /** 活四: 防御不能の脅威 */
  openFour: 0.95,
  /** 止め四: 絶対先手の脅威 */
  four: 0.7,
  /** 活三: 相対先手の脅威 */
  openThree: 0.7,
  /** 止め三: 低優先度 */
  three: 0.3,
  /** 活二: 軽微 */
  openTwo: 0.2,
  /** 止め二: 無視可能 */
  two: 0.1,
} as const;

/**
 * 防御倍率を適用
 */
export function applyDefenseMultiplier(
  detail: PatternScoreDetail,
  multiplier = 0.5,
): PatternScoreDetail {
  return {
    base: Math.round(detail.base * multiplier),
    diagonalBonus: Math.round(detail.diagonalBonus * multiplier),
    final: Math.round(detail.final * multiplier),
    preMultiplier: detail.final, // 倍率前の値（斜めボーナス込み）
    multiplier,
  };
}
