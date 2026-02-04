/**
 * 候補手生成
 *
 * 既存石の周囲2マスのみを探索対象とし、黒番の場合は禁手を除外。
 */

import type { BoardState, Position, StoneColor } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import { checkFive, isValidPosition } from "@/logic/renjuRules";

import { checkForbiddenMoveWithCache } from "./cache/forbiddenCache";
import { sortMoves, type MoveOrderingOptions } from "./moveOrdering";

// Re-export from moveOrdering for backward compatibility
export {
  clearHistoryTable,
  createHistoryTable,
  createKillerMoves,
  getHistoryScore,
  getKillerMoves,
  type HistoryTable,
  type KillerMoves,
  type MoveOrderingOptions,
  recordKillerMove,
  sortMoves,
  updateHistory,
} from "./moveOrdering";

/** 探索範囲（既存石からの距離） */
const SEARCH_RANGE = 2;

/**
 * 指定位置が既存の石の周囲にあるかチェック
 *
 * @param board 盤面
 * @param row 行
 * @param col 列
 * @param range 範囲（デフォルト: 2）
 * @returns 既存石の周囲にあればtrue
 */
export function isNearExistingStone(
  board: BoardState,
  row: number,
  col: number,
  range: number = SEARCH_RANGE,
): boolean {
  for (let dr = -range; dr <= range; dr++) {
    for (let dc = -range; dc <= range; dc++) {
      if (dr === 0 && dc === 0) {
        continue;
      }

      const nr = row + dr;
      const nc = col + dc;

      if (isValidPosition(nr, nc) && board[nr]?.[nc] !== null) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 候補手生成オプション
 */
export interface GenerateMovesOptions {
  /**
   * 禁手判定をスキップするか
   *
   * trueの場合、黒番でも禁手判定を行わない。
   * 探索時に遅延禁手判定を行う場合に使用。
   */
  skipForbiddenCheck?: boolean;
}

/**
 * 候補手を生成
 *
 * @param board 盤面
 * @param color 手番の色
 * @param options オプション
 * @returns 候補手の配列
 */
export function generateMoves(
  board: BoardState,
  color: StoneColor,
  options: GenerateMovesOptions = {},
): Position[] {
  const moves: Position[] = [];
  const isBlack = color === "black";

  // 盤面に石があるかチェック
  let hasStones = false;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== null) {
        hasStones = true;
        break;
      }
    }
    if (hasStones) {
      break;
    }
  }

  // 石がない場合は中央のみ
  if (!hasStones) {
    return [{ row: 7, col: 7 }];
  }

  // 既存石の周囲2マスを候補として収集
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      // 空きマスでなければスキップ
      if (board[row]?.[col] !== null) {
        continue;
      }

      // 既存石の周囲でなければスキップ
      if (!isNearExistingStone(board, row, col)) {
        continue;
      }

      // 黒番の場合は禁手チェック（スキップオプションがない場合）
      if (isBlack && !options.skipForbiddenCheck) {
        // 五連が作れる場合は禁手でも候補に含める
        if (checkFive(board, row, col, "black")) {
          moves.push({ row, col });
          continue;
        }

        // 禁手チェック（キャッシュ付き）
        const forbiddenResult = checkForbiddenMoveWithCache(board, row, col);
        if (forbiddenResult.isForbidden) {
          continue;
        }
      }

      moves.push({ row, col });
    }
  }

  return moves;
}

/** ソート済み候補手生成オプション（MoveOrderingOptions + GenerateMovesOptions） */
export interface SortedMovesOptions extends MoveOrderingOptions {
  /** 禁手判定をスキップするか */
  skipForbiddenCheck?: boolean;
}

/**
 * ソート済み候補手を生成
 *
 * generateMoves()とsortMoves()を統合した便利関数
 *
 * @param board 盤面
 * @param color 手番
 * @param options ソートオプション
 * @returns ソート済み候補手配列
 */
export function generateSortedMoves(
  board: BoardState,
  color: StoneColor,
  options: SortedMovesOptions = {},
): Position[] {
  const moves = generateMoves(board, color, {
    skipForbiddenCheck: options.skipForbiddenCheck,
  });

  // 候補が0〜1個の場合はソート不要
  if (moves.length <= 1) {
    return moves;
  }

  return sortMoves(moves, board, color, options);
}
