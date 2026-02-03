/**
 * 探索テクニック
 *
 * LMR (Late Move Reductions)、Aspiration Windows、動的時間配分などの
 * 探索最適化テクニック
 */

import type { BoardState, Position } from "@/types/game";

import { checkJumpFour } from "@/logic/renjuRules";

import { countStones } from "../core/boardUtils";
import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { checkEnds, countLine } from "../core/lineAnalysis";

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
export function calculateDynamicTimeLimit(
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
export const LMR_MOVE_THRESHOLD = 4;

/** LMRを適用する最小探索深度 */
export const LMR_MIN_DEPTH = 3;

/** LMRによる探索深度の削減量 */
export const LMR_REDUCTION = 1;

/**
 * 四を作る手かどうかをチェック（LMR除外用）
 *
 * 連珠では一手で形勢が激変するため、四を作る手にLMRを適用すると
 * 重要な手を見逃すリスクがある。この関数で四を作る手を検出し、
 * LMRから除外する。
 *
 * @param board 盤面
 * @param move 着手位置
 * @param color 石の色
 * @returns 四を作る手ならtrue
 */
export function isTacticalMove(
  board: BoardState,
  move: Position,
  color: "black" | "white",
): boolean {
  const row = board[move.row];
  if (!row) {
    return false;
  }

  // 盤面を一時的に変更（copyBoardを避けて高速化）
  // 候補手の位置は常に空きなので、復元時はnullに戻す
  row[move.col] = color;

  let isTactical = false;

  // 4方向をチェック
  for (let i = 0; i < DIRECTIONS.length; i++) {
    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;

    // 連続四をチェック（count === 4 で片端以上が開いている）
    const count = countLine(board, move.row, move.col, dr, dc, color);
    if (count === 4) {
      const { end1Open, end2Open } = checkEnds(
        board,
        move.row,
        move.col,
        dr,
        dc,
        color,
      );
      if (end1Open || end2Open) {
        isTactical = true;
        break;
      }
    }

    // 跳び四をチェック（連続四でない場合のみ）
    // DIRECTION_INDICES[i] で 8方向のインデックスに変換
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex !== undefined && count !== 4) {
      if (checkJumpFour(board, move.row, move.col, dirIndex, color)) {
        isTactical = true;
        break;
      }
    }
  }

  // 盤面を復元（候補手の位置は常に空きだったのでnullに戻す）
  row[move.col] = null;

  return isTactical;
}

// =============================================================================
// Aspiration Windows パラメータ
// =============================================================================

/** Aspiration Windowの初期幅 */
export const ASPIRATION_WINDOW = 50;

/** デフォルトの絶対時間制限（10秒） */
export const DEFAULT_ABSOLUTE_TIME_LIMIT = 10000;

/** 無限大の代わりに使う大きな値 */
export const INFINITY = 1000000;
