/**
 * CPU盤面ユーティリティ関数
 *
 * SSoT (Single Source of Truth) として盤面操作関数を提供
 */

import type { BoardState, Position, StoneColor } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import { copyBoard } from "@/logic/renjuRules";

/**
 * 反対の色を取得
 */
export function getOppositeColor(color: "black" | "white"): "black" | "white" {
  return color === "black" ? "white" : "black";
}

/**
 * 盤面上の石の数をカウント
 */
export function countStones(board: BoardState): number {
  let count = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== null) {
        count++;
      }
    }
  }
  return count;
}

/**
 * 盤面に石を配置した新しい盤面を返す
 *
 * @param board 元の盤面（変更されない）
 * @param move 配置位置
 * @param color 石の色
 * @returns 石を配置した新しい盤面
 */
export function applyMove(
  board: BoardState,
  move: Position,
  color: StoneColor,
): BoardState {
  const newBoard = copyBoard(board);
  const row = newBoard[move.row];
  if (row) {
    row[move.col] = color;
  }
  return newBoard;
}

/**
 * 盤面に石を配置（インプレース変更）
 *
 * 盤面を直接変更するため、探索後に必ずundoMoveを呼ぶこと。
 *
 * @param board 盤面（直接変更される）
 * @param move 配置位置
 * @param color 石の色
 */
export function applyMoveInPlace(
  board: BoardState,
  move: Position,
  color: StoneColor,
): void {
  const row = board[move.row];
  if (row) {
    row[move.col] = color;
  }
}

/**
 * 盤面から石を除去（インプレース変更）
 *
 * applyMoveInPlaceで配置した石を戻すために使用。
 *
 * @param board 盤面（直接変更される）
 * @param move 除去位置
 */
export function undoMove(board: BoardState, move: Position): void {
  const row = board[move.row];
  if (row) {
    row[move.col] = null;
  }
}

/**
 * 配列からランダムに1要素を選択
 *
 * @param array 選択対象の配列
 * @param random ランダム生成関数（デフォルト: Math.random）
 * @returns 選択された要素（配列が空の場合はundefined）
 */
export function selectRandom<T>(
  array: readonly T[],
  random: () => number = Math.random,
): T | undefined {
  if (array.length === 0) {
    return undefined;
  }
  const index = Math.floor(random() * array.length);
  return array[index];
}

/**
 * 時間計測用インターフェース
 */
export interface Clock {
  now(): number;
}

/**
 * システムクロック（performance.now使用）
 */
export const systemClock: Clock = {
  now: () => performance.now(),
};

/**
 * ランダム生成インターフェース
 */
export interface RandomSource {
  random(): number;
}

/**
 * デフォルトのランダム生成器
 */
export const defaultRandom: RandomSource = {
  random: () => Math.random(),
};
