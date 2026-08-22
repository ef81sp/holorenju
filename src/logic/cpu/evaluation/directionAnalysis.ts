/**
 * 方向パターン分析
 *
 * 連続石のカウントと端状態判定
 */

import type { BoardState } from "@/types/game";

import {
  isFiveLength,
  isValidPosition,
  type PlayerColor,
} from "@/logic/renjuRules";

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
  const count = pos.count + neg.count + 1; // +1は起点自身
  let end1 = pos.endState;
  let end2 = neg.endState;

  // 黒の count=4: オーバーライン補正
  // empty 端の先に自色石がある場合、伸ばすと6連になるため塞がりとして扱う
  if (color === "black" && count === 4) {
    if (end1 === "empty") {
      const bR = row + dr * (pos.count + 2);
      const bC = col + dc * (pos.count + 2);
      if (isValidPosition(bR, bC) && board[bR]?.[bC] === "black") {
        end1 = "opponent";
      }
    }
    if (end2 === "empty") {
      const bR = row - dr * (neg.count + 2);
      const bC = col - dc * (neg.count + 2);
      if (isValidPosition(bR, bC) && board[bR]?.[bC] === "black") {
        end2 = "opponent";
      }
    }
  }

  return { count, end1, end2 };
}

/**
 * パターンからスコアを計算
 *
 * 五の判定は `renjuRules.isFiveLength` に委ねる（SSoT・#125）。黒はちょうど 5 連、
 * 白は 5 連以上が五。**黒の 6 連以上は長連＝禁手なので五でも四でもなく 0 点**（#132、
 * `renjuRules.isOverlineLength` と同値）。
 *
 * Zig 側の対は `zig/src/patterns.zig` の `getPatternScore`。
 * パリティテスト: `patternScoreParity.wasm.test.ts`
 *
 * ⚠️ **本番探索からの消費者はゼロ**（探索は WASM 専用）。live な呼び出し元は
 * `lineTable/lineScan.ts` のテーブル構築とテストのみで、実質 Zig 実装のパリティ用
 * 参照実装として残っている（#43 の死蔵棚卸し候補）。
 *
 * @param pattern パターン分析結果
 * @param color 石の色（黒の長連を五から除外するために必要）
 * @returns スコア
 */
export function getPatternScore(
  pattern: DirectionPattern,
  color: PlayerColor,
): number {
  const { count, end1, end2 } = pattern;
  // count >= 5 は「五」か「黒の長連」のいずれか。isFiveLength が false なら
  // 残るのは黒の長連だけ（= isOverlineLength(count, color)）。
  // count 0..4 を 1 比較で switch に落とすためにこの形にしている。
  if (count >= 5) {
    return isFiveLength(count, color) ? PATTERN_SCORES.FIVE : 0;
  }

  const bothOpen = end1 === "empty" && end2 === "empty";
  const oneOpen = end1 === "empty" || end2 === "empty";

  switch (count) {
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
 *
 * 五の判定は `getPatternScore` と同じく `renjuRules.isFiveLength`（#125）。
 * 黒の 6 連以上（長連＝禁手）は `null`（#132）。
 */
export function getPatternType(
  pattern: DirectionPattern,
  color: PlayerColor,
): PatternType {
  const { count, end1, end2 } = pattern;
  if (count >= 5) {
    return isFiveLength(count, color) ? "five" : null;
  }

  const bothOpen = end1 === "empty" && end2 === "empty";
  const oneOpen = end1 === "empty" || end2 === "empty";

  switch (count) {
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
