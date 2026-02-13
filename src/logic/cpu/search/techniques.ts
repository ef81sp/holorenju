/**
 * 探索テクニック
 *
 * LMR (Late Move Reductions)、Aspiration Windows、動的時間配分などの
 * 探索最適化テクニック
 */

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import { checkJumpFour, isValidPosition } from "@/logic/renjuRules";

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
export const LMR_MOVE_THRESHOLD = 3;

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

/** Aspiration Windowの初期幅（FOUR=1500 に対する比率 75/1500=5% は旧比率 50/1000=5% と同等） */
export const ASPIRATION_WINDOW = 75;

/** デフォルトの絶対時間制限（10秒） */
export const DEFAULT_ABSOLUTE_TIME_LIMIT = 10000;

/** 無限大の代わりに使う大きな値 */
export const INFINITY = 1000000;

// =============================================================================
// Null Move Pruning パラメータ
// =============================================================================

/** NMP を適用する最小探索深度 */
export const NMP_MIN_DEPTH = 3;

/** NMP による探索深度の削減量 */
export const NMP_REDUCTION = 2;

// =============================================================================
// Futility Pruning パラメータ
// =============================================================================

/**
 * 手番別 Futility マージン（index = depth）
 *
 * 実測データ（docs/futility-margin-analysis.md）に基づく:
 * - 自分の手: 静的評価が正確で gain が小さい → P95ベースで積極的に刈る
 * - 相手の手: 防御手・カウンター脅威は探索で判明 → P95付近で慎重に刈る
 *
 * FOUR=1500 スコア分布での再計測値（2026-02-13）:
 *   Self  d1 P95=987, d2 P95=108
 *   Opp   d1 P95=4099, d2 P95=1207, d3 P95=2899
 */
export const FUTILITY_MARGINS_SELF = [0, 1000, 200, 1000] as const;
export const FUTILITY_MARGINS_OPPONENT = [0, 4100, 1300, 3000] as const;

// =============================================================================
// Null Move Pruning 用の軽量脅威チェック
// =============================================================================

/** 4方向ベクトル（横, 縦, 右下斜め, 右上斜め） */
const NMP_DIRECTIONS: readonly [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * 指定位置から指定方向に四以上の連があるかチェック
 *
 * @returns 連続4個以上で片端以上が空いている場合 true
 */
function hasFourInDirection(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): boolean {
  // 重複カウント防止: 正方向の起点のみチェック
  const prevR = row - dr;
  const prevC = col - dc;
  if (isValidPosition(prevR, prevC) && board[prevR]?.[prevC] === color) {
    return false;
  }

  // 正方向に連続する石の数をカウント
  let count = 1;
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    count++;
    r += dr;
    c += dc;
  }

  if (count < 4) {
    return false;
  }

  // 4個以上の連続: 片端以上が空いていれば四（または五以上）
  const end1Open = isValidPosition(r, c) && board[r]?.[c] === null;
  const end2Open =
    isValidPosition(prevR, prevC) && board[prevR]?.[prevC] === null;
  return end1Open || end2Open;
}

/**
 * 相手に即座の脅威（四: 連続4個で片端以上開き）があるかを軽量にチェック
 *
 * detectOpponentThreats より大幅に軽量（活三・ミセ手の検出なし）。
 * NMP の適用条件判定に使用。
 *
 * @param board 盤面
 * @param opponentColor 相手の色
 * @returns 相手に四がある場合 true
 */
// =============================================================================
// Time-Pressure Fallback パラメータ
// =============================================================================

/** フォールバック対象の最低スコア（四三相当: FOUR + OPEN_THREE） */
export const WINNING_SCORE_THRESHOLD = 2500;

/** フォールバック発動のスコア低下閾値（FOUR相当） */
export const TIME_PRESSURE_FALLBACK_THRESHOLD = 1500;

// =============================================================================
// Null Move Pruning 用の軽量脅威チェック
// =============================================================================

export function hasImmediateThreat(
  board: BoardState,
  opponentColor: "black" | "white",
): boolean {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== opponentColor) {
        continue;
      }

      for (const [dr, dc] of NMP_DIRECTIONS) {
        if (hasFourInDirection(board, row, col, dr, dc, opponentColor)) {
          return true;
        }
      }
    }
  }
  return false;
}
