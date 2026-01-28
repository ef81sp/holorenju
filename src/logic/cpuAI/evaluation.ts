/**
 * 盤面評価関数
 *
 * recognizePatternを活用してパターンベースのスコアリングを行う
 */

import type { BoardState, StoneColor } from "@/types/game";

import { checkFive, copyBoard, recognizePattern } from "@/logic/renjuRules";

/**
 * パターンスコア定数
 */
export const PATTERN_SCORES = {
  /** 五連（勝利） */
  FIVE: 100000,
  /** 活四（両端開） */
  OPEN_FOUR: 5000,
  /** 止め四（片端開） */
  FOUR: 500,
  /** 活三（両端開） */
  OPEN_THREE: 300,
  /** 止め三（片端開） */
  THREE: 50,
  /** 活二 */
  OPEN_TWO: 10,
  /** 中央寄りボーナス */
  CENTER_BONUS: 5,
  /** 禁じ手誘導ボーナス（白番） */
  FORBIDDEN_TRAP: 100,
} as const;

/**
 * 中央からの距離に基づくボーナスを計算
 * 中央（7,7）に近いほど高いスコア
 */
function getCenterBonus(row: number, col: number): number {
  const centerRow = 7;
  const centerCol = 7;
  const distance = Math.abs(row - centerRow) + Math.abs(col - centerCol);
  // 最大距離は14（角から中央）、距離が近いほど高スコア
  return Math.max(0, PATTERN_SCORES.CENTER_BONUS * (14 - distance)) / 14;
}

/**
 * 指定位置に石を置いた場合の評価スコアを計算
 *
 * @param board 現在の盤面
 * @param row 行
 * @param col 列
 * @param color 石の色
 * @returns 評価スコア
 */
export function evaluatePosition(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
): number {
  if (color === null) {
    return 0;
  }

  // 五連チェック（最優先）
  if (checkFive(board, row, col, color)) {
    return PATTERN_SCORES.FIVE;
  }

  // 仮想的に石を置いた盤面でパターンを認識
  const testBoard = copyBoard(board);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = color;
  }

  const patterns = recognizePattern(testBoard, row, col, color);

  let score = 0;

  for (const pattern of patterns) {
    switch (pattern.type) {
      case "five":
        score += PATTERN_SCORES.FIVE;
        break;
      case "open-four":
        score += PATTERN_SCORES.OPEN_FOUR;
        break;
      case "four-three":
        // 四三は活四+活三の複合形なので高評価
        score += PATTERN_SCORES.OPEN_FOUR + PATTERN_SCORES.OPEN_THREE;
        break;
      case "open-three":
        score += PATTERN_SCORES.OPEN_THREE;
        break;
      case "overline":
        // 長連は黒にとってマイナス（禁手）
        if (color === "black") {
          score -= PATTERN_SCORES.FIVE;
        }
        break;
      default:
        // 未知のパターンは無視
        break;
    }
  }

  // 中央ボーナスを追加（パターンがない場合でも位置の価値を評価）
  score += getCenterBonus(row, col);

  return score;
}

/**
 * パターンタイプからスコアを計算
 */
function getPatternScore(
  patternType: string,
  stone: "black" | "white",
): number {
  switch (patternType) {
    case "five":
      return PATTERN_SCORES.FIVE;
    case "open-four":
      return PATTERN_SCORES.OPEN_FOUR;
    case "four-three":
      return PATTERN_SCORES.OPEN_FOUR + PATTERN_SCORES.OPEN_THREE;
    case "open-three":
      return PATTERN_SCORES.OPEN_THREE;
    case "overline":
      // 長連は黒にとってマイナス
      return stone === "black" ? -PATTERN_SCORES.FIVE : 0;
    default:
      return 0;
  }
}

/**
 * 特定位置の石のパターンスコアを評価
 */
function evaluateStonePatterns(
  board: BoardState,
  row: number,
  col: number,
  stone: "black" | "white",
  perspective: "black" | "white",
): number {
  const patterns = recognizePattern(board, row, col, stone);
  let score = 0;

  for (const pattern of patterns) {
    const patternScore = getPatternScore(pattern.type, stone);
    // 視点に応じてスコアを加減算
    score += stone === perspective ? patternScore : -patternScore;
  }

  return score;
}

/**
 * 盤面全体の評価スコアを計算
 *
 * @param board 盤面
 * @param perspective 評価する視点（黒/白）
 * @returns 評価スコア（正:perspective有利、負:相手有利）
 */
export function evaluateBoard(
  board: BoardState,
  perspective: "black" | "white",
): number {
  let score = 0;

  // 全ての石について評価
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const stone = board[row]?.[col];
      if (stone === null || stone === undefined) {
        continue;
      }

      score += evaluateStonePatterns(board, row, col, stone, perspective);
    }
  }

  return score;
}
