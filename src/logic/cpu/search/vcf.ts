/**
 * VCF（Victory by Continuous Fours）探索
 *
 * 四を連続して打つことで勝利する手順を探索する。
 * 白番の場合、黒の防御点が禁手なら即勝利。
 */

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import {
  checkFive,
  checkForbiddenMove,
  checkJumpFour,
  copyBoard,
  isValidPosition,
} from "@/logic/renjuRules";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { countLine } from "../core/lineAnalysis";
import { isNearExistingStone } from "../moveGenerator";
import { findJumpGapPosition } from "../patterns/threatAnalysis";
import { createsFour } from "./threatMoves";

// 後方互換性のためライン解析関数を再export
export { checkEnds, countLine } from "../core/lineAnalysis";

/** VCF探索の最大深度 */
const VCF_MAX_DEPTH = 8;

/** VCF探索の時間制限（ミリ秒） */
const VCF_TIME_LIMIT = 150;

/**
 * VCF探索用の時間制限コンテキスト
 */
export interface VCFTimeLimiter {
  startTime: number;
  timeLimit: number;
}

/**
 * VCFが成立するかチェック
 *
 * @param board 盤面
 * @param color 手番
 * @param depth 現在の探索深度
 * @param timeLimiter 時間制限コンテキスト（ルート呼び出し時は省略可）
 * @returns VCFが成立する場合true
 */
export function hasVCF(
  board: BoardState,
  color: "black" | "white",
  depth = 0,
  timeLimiter?: VCFTimeLimiter,
): boolean {
  // 時間制限の初期化（ルート呼び出し時）
  const limiter = timeLimiter ?? {
    startTime: performance.now(),
    timeLimit: VCF_TIME_LIMIT,
  };

  // 時間制限チェック
  if (performance.now() - limiter.startTime >= limiter.timeLimit) {
    return false;
  }

  if (depth >= VCF_MAX_DEPTH) {
    return false;
  }

  // 四を作れる位置を列挙
  const fourMoves = findFourMoves(board, color);

  for (const move of fourMoves) {
    // 四を作る
    const afterFour = copyBoard(board);
    const afterFourRow = afterFour[move.row];
    if (afterFourRow) {
      afterFourRow[move.col] = color;
    }

    // 五連チェック
    if (checkFive(afterFour, move.row, move.col, color)) {
      return true;
    }

    // 相手の応手（四を止める）
    const defensePos = getFourDefensePosition(afterFour, move, color);

    if (!defensePos) {
      // 止められない = 勝利
      return true;
    }

    // 白番の場合、黒の防御位置が禁手ならVCF成立
    if (color === "white") {
      const forbiddenResult = checkForbiddenMove(
        afterFour,
        defensePos.row,
        defensePos.col,
      );
      if (forbiddenResult.isForbidden) {
        return true;
      }
    }

    // 相手が止めた後の局面で再帰
    const afterDefense = copyBoard(afterFour);
    const opponentColor = color === "black" ? "white" : "black";
    const afterDefenseRow = afterDefense[defensePos.row];
    if (afterDefenseRow) {
      afterDefenseRow[defensePos.col] = opponentColor;
    }

    if (hasVCF(afterDefense, color, depth + 1, limiter)) {
      return true;
    }
  }

  return false;
}

/**
 * VCFの最初の手を返す
 *
 * @param board 盤面
 * @param color 手番
 * @returns VCFの最初の四追い手、なければnull
 */
export function findVCFMove(
  board: BoardState,
  color: "black" | "white",
): Position | null {
  return findVCFMoveRecursive(board, color, 0);
}

/**
 * VCFの最初の手を返す（再帰版）
 */
function findVCFMoveRecursive(
  board: BoardState,
  color: "black" | "white",
  depth: number,
): Position | null {
  if (depth >= VCF_MAX_DEPTH) {
    return null;
  }

  const fourMoves = findFourMoves(board, color);

  // 最優先: 即座に五連を作れる手を探す
  for (const move of fourMoves) {
    const testBoard = copyBoard(board);
    const testRow = testBoard[move.row];
    if (testRow) {
      testRow[move.col] = color;
    }
    if (checkFive(testBoard, move.row, move.col, color)) {
      return move;
    }
  }

  // 通常のVCF探索
  for (const move of fourMoves) {
    // 四を作る
    const afterFour = copyBoard(board);
    const afterFourRow = afterFour[move.row];
    if (afterFourRow) {
      afterFourRow[move.col] = color;
    }

    // 五連チェック（上で既にチェック済みなのでスキップ可能だが、念のため残す）
    if (checkFive(afterFour, move.row, move.col, color)) {
      return move;
    }

    // 相手の応手（四を止める）
    const defensePos = getFourDefensePosition(afterFour, move, color);

    if (!defensePos) {
      // 止められない = 勝利
      return move;
    }

    // 白番の場合、黒の防御位置が禁手ならVCF成立
    if (color === "white") {
      const forbiddenResult = checkForbiddenMove(
        afterFour,
        defensePos.row,
        defensePos.col,
      );
      if (forbiddenResult.isForbidden) {
        return move;
      }
    }

    // 相手が止めた後の局面で再帰
    const afterDefense = copyBoard(afterFour);
    const opponentColor = color === "black" ? "white" : "black";
    const afterDefenseRow = afterDefense[defensePos.row];
    if (afterDefenseRow) {
      afterDefenseRow[defensePos.col] = opponentColor;
    }

    const vcfMove = findVCFMoveRecursive(afterDefense, color, depth + 1);
    if (vcfMove !== null) {
      // depth=0の場合は最初の手を返す
      return depth === 0 ? move : vcfMove;
    }
  }

  return null;
}

/**
 * 四を作れる位置を列挙
 * @internal テスト用にexport
 */
export function findFourMoves(
  board: BoardState,
  color: "black" | "white",
): Position[] {
  const moves: Position[] = [];

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, row, col)) {
        continue;
      }

      // 五連が作れる場合は最優先で候補に含める
      if (checkFive(board, row, col, color)) {
        moves.push({ row, col });
        continue;
      }

      // 黒の禁手チェック
      if (color === "black") {
        const forbidden = checkForbiddenMove(board, row, col);
        if (forbidden.isForbidden) {
          continue;
        }
      }

      // 四が作れるかチェック（仮想的に石を置いて判定）
      const testBoard = copyBoard(board);
      const testRow = testBoard[row];
      if (testRow) {
        testRow[col] = color;
      }
      if (createsFour(testBoard, row, col, color)) {
        moves.push({ row, col });
      }
    }
  }

  return moves;
}

/**
 * 四に対する防御位置を取得
 * 四は1点でしか止められないので、その位置を返す
 *
 * @param board 盤面（四が作られた状態）
 * @param lastMove 最後に置かれた手
 * @param color 四を作った手番
 * @returns 防御位置（止められない場合はnull）
 */
function getFourDefensePosition(
  board: BoardState,
  lastMove: Position,
  color: "black" | "white",
): Position | null {
  const { row, col } = lastMove;

  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) {
      continue;
    }

    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;

    // 連続四をチェック
    const count = countLine(board, row, col, dr, dc, color);
    if (count === 4) {
      const defensePos = findDefenseForConsecutiveFour(
        board,
        row,
        col,
        dr,
        dc,
        color,
      );
      if (defensePos) {
        return defensePos;
      }
    }

    // 跳び四をチェック
    if (count !== 4 && checkJumpFour(board, row, col, dirIndex, color)) {
      const defensePos = findDefenseForJumpFour(board, row, col, dr, dc, color);
      if (defensePos) {
        return defensePos;
      }
    }
  }

  return null;
}

/**
 * 連続四に対する防御位置を取得
 * @internal テスト用にexport
 */
export function findDefenseForConsecutiveFour(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): Position | null {
  const defensePositions: Position[] = [];

  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    defensePositions.push({ row: r, col: c });
  }

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r -= dr;
    c -= dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    defensePositions.push({ row: r, col: c });
  }

  // 止め四の場合は1点のみ
  if (defensePositions.length === 1) {
    return defensePositions[0] ?? null;
  }

  // 活四の場合は止められない（nullを返す = 勝利）
  if (defensePositions.length === 2) {
    return null;
  }

  return null;
}

/**
 * 跳び四に対する防御位置を取得
 * 跳び四は中の空きを埋めるしかない
 * @internal テスト用にexport
 */
export function findDefenseForJumpFour(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): Position | null {
  return findJumpGapPosition(board, row, col, dr, dc, color);
}
