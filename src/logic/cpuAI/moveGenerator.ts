/**
 * 候補手生成
 *
 * 既存石の周囲2マスのみを探索対象とし、黒番の場合は禁手を除外
 */

import type { BoardState, Position, StoneColor } from "@/types/game";

import {
  checkFive,
  checkForbiddenMove,
  isValidPosition,
} from "@/logic/renjuRules";

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
 * 候補手を生成
 *
 * @param board 盤面
 * @param color 手番の色
 * @returns 候補手の配列
 */
export function generateMoves(
  board: BoardState,
  color: StoneColor,
): Position[] {
  const moves: Position[] = [];
  const isBlack = color === "black";

  // 盤面に石があるかチェック
  let hasStones = false;
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
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
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      // 空きマスでなければスキップ
      if (board[row]?.[col] !== null) {
        continue;
      }

      // 既存石の周囲でなければスキップ
      if (!isNearExistingStone(board, row, col)) {
        continue;
      }

      // 黒番の場合は禁手チェック
      if (isBlack) {
        // 五連が作れる場合は禁手でも候補に含める
        if (checkFive(board, row, col, "black")) {
          moves.push({ row, col });
          continue;
        }

        // 禁手チェック
        const forbiddenResult = checkForbiddenMove(board, row, col);
        if (forbiddenResult.isForbidden) {
          continue;
        }
      }

      moves.push({ row, col });
    }
  }

  return moves;
}
