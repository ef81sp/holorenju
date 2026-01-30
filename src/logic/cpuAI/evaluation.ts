/**
 * 盤面評価関数
 *
 * 独自のパターンカウント関数を使用してスコアリングを行う
 */

import type { BoardState, StoneColor } from "@/types/game";

import { checkFive, copyBoard, isValidPosition } from "@/logic/renjuRules";

/**
 * パターンスコア定数
 */
export const PATTERN_SCORES = {
  /** 五連（勝利） */
  FIVE: 100000,
  /** 活四（両端開） */
  OPEN_FOUR: 10000,
  /** 止め四（片端開） */
  FOUR: 1000,
  /** 活三（両端開） */
  OPEN_THREE: 1000,
  /** 止め三（片端開） */
  THREE: 100,
  /** 活二 */
  OPEN_TWO: 50,
  /** 止め二 */
  TWO: 10,
  /** 中央寄りボーナス */
  CENTER_BONUS: 5,
  /** 禁じ手誘導ボーナス（白番） */
  FORBIDDEN_TRAP: 100,
} as const;

/**
 * 4方向のベクトル
 * [dr, dc]: 行方向, 列方向
 */
const DIRECTIONS: [number, number][] = [
  [0, 1], // 横（右）
  [1, 0], // 縦（下）
  [1, 1], // 右下斜め
  [1, -1], // 右上斜め
];

/**
 * 端の状態
 */
type EndState = "empty" | "opponent" | "edge";

/**
 * 方向パターン分析結果
 */
interface DirectionPattern {
  /** 連続する石の数 */
  count: number;
  /** 正方向の端の状態 */
  end1: EndState;
  /** 負方向の端の状態 */
  end2: EndState;
}

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
function countInDirection(
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
function analyzeDirection(
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
function getPatternScore(pattern: DirectionPattern): number {
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
function getCenterBonus(row: number, col: number): number {
  const centerRow = 7;
  const centerCol = 7;
  const distance = Math.abs(row - centerRow) + Math.abs(col - centerCol);
  // 最大距離は14（角から中央）、距離が近いほど高スコア
  return Math.max(0, PATTERN_SCORES.CENTER_BONUS * (14 - distance)) / 14;
}

/**
 * 指定位置の石について全方向のパターンスコアを計算
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
): number {
  let score = 0;

  for (const [dr, dc] of DIRECTIONS) {
    const pattern = analyzeDirection(board, row, col, dr, dc, color);
    score += getPatternScore(pattern);
  }

  return score;
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

  // 仮想的に石を置いた盤面でパターンを評価
  const testBoard = copyBoard(board);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = color;
  }

  // 攻撃スコア: 自分のパターン
  const attackScore = evaluateStonePatterns(testBoard, row, col, color);

  // 防御スコア: 相手の脅威をブロック
  const opponentColor = color === "black" ? "white" : "black";
  let defenseScore = 0;

  // この位置に相手が置いた場合のスコアを計算（ブロック価値）
  const opponentTestBoard = copyBoard(board);
  const opponentTestRow = opponentTestBoard[row];
  if (opponentTestRow) {
    opponentTestRow[col] = opponentColor;
  }
  const opponentPatternScore = evaluateStonePatterns(
    opponentTestBoard,
    row,
    col,
    opponentColor,
  );

  // 相手の活三・活四をブロックする手は高評価
  // ブロック価値は相手のスコアの50%
  defenseScore = opponentPatternScore * 0.5;

  // 中央ボーナスを追加
  const centerBonus = getCenterBonus(row, col);

  return attackScore + defenseScore + centerBonus;
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
  const opponentColor = perspective === "black" ? "white" : "black";
  let myScore = 0;
  let opponentScore = 0;

  // 全ての石について評価
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const stone = board[row]?.[col];
      if (stone === null || stone === undefined) {
        continue;
      }

      const patternScore = evaluateStonePatterns(board, row, col, stone);

      if (stone === perspective) {
        myScore += patternScore;
      } else if (stone === opponentColor) {
        opponentScore += patternScore;
      }
    }
  }

  return myScore - opponentScore;
}
