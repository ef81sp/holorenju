/**
 * コア機能: 基本定数、位置判定、盤面操作、ライン解析、五連・長連検出
 *
 * パフォーマンス上の理由から、ホットパスで相互呼び出しされる関数群を
 * 単一モジュールにまとめている（V8のモジュール境界を越えるインライン化制限の回避）。
 */

import type { BoardState, Position, StoneColor } from "@/types/game";

import { incrementBoardCopies } from "@/logic/cpu/profiling/counters";

// =============================================================================
// 引き分けルール
// =============================================================================

/** 引き分けとなる手数上限（ゲームルールとして定義） */
export const DRAW_MOVE_LIMIT = 70;

/**
 * 引き分け判定
 *
 * 総手数が上限に達したら引き分けとする
 *
 * @param moveCount 現在の総手数
 * @returns 引き分けならtrue
 */
export function checkDraw(moveCount: number): boolean {
  return moveCount >= DRAW_MOVE_LIMIT;
}

// 8方向のベクトル（上、右上、右、右下、下、左下、左、左上）
export const DIRECTIONS = [
  { dc: 0, dr: -1 }, // 上
  { dc: 1, dr: -1 }, // 右上
  { dc: 1, dr: 0 }, // 右
  { dc: 1, dr: 1 }, // 右下
  { dc: 0, dr: 1 }, // 下
  { dc: -1, dr: 1 }, // 左下
  { dc: -1, dr: 0 }, // 左
  { dc: -1, dr: -1 }, // 左上
];

// 4方向のペア（縦、横、斜め右、斜め左）
export const DIRECTION_PAIRS = [
  [0, 4], // 縦
  [2, 6], // 横
  [1, 5], // 斜め右
  [3, 7], // 斜め左
];

/**
 * 指定位置が盤面内かチェック
 * @returns 位置が盤面内であればtrue
 */
export function isValidPosition(row: number, col: number): boolean {
  return row >= 0 && row < 15 && col >= 0 && col < 15;
}

/**
 * 空の盤面を生成
 * @returns 空の盤面状態
 */
export function createEmptyBoard(): BoardState {
  return new Array(15).fill(null).map(() => new Array(15).fill(null));
}

/**
 * 盤面をコピー
 * @returns コピーされた盤面状態
 */
export function copyBoard(board: BoardState): BoardState {
  // プロファイリング: 盤面コピー回数をカウント
  incrementBoardCopies();
  return board.map((row: StoneColor[]) => [...row]);
}

// =============================================================================
// ライン解析
// =============================================================================

/**
 * 指定方向に連続する石の数をカウント
 * @returns 連続する石の数
 */
export function countStones(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: StoneColor,
): number {
  let count = 0;
  let r = row + dr;
  let c = col + dc;

  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    count++;
    r += dr;
    c += dc;
  }

  return count;
}

/**
 * 指定位置に石を置いた場合の連続数を取得（両方向）
 * @returns 両方向の連続数合計
 */
export function getLineLength(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: StoneColor,
): number {
  const dir1 = DIRECTIONS[dirIndex];
  const dir2 = DIRECTIONS[(dirIndex + 4) % 8];

  if (!dir1 || !dir2) {
    return 0;
  }

  const count1 = countStones(board, row, col, dir1.dr, dir1.dc, color);
  const count2 = countStones(board, row, col, dir2.dr, dir2.dc, color);

  return count1 + count2 + 1; // +1は自分自身
}

// =============================================================================
// 五連・長連検出
// =============================================================================

/**
 * 五連をチェック
 * @returns 五連が成立する場合true
 */
export function checkFive(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
): boolean {
  for (let i = 0; i < 4; i++) {
    const pair = DIRECTION_PAIRS[i];
    if (!pair) {
      continue;
    }
    const [dir1Index] = pair;
    if (dir1Index === undefined) {
      continue;
    }
    const length = getLineLength(board, row, col, dir1Index, color);
    if (length === 5) {
      return true;
    }
  }
  return false;
}

/**
 * 長連（6個以上の連）をチェック
 */
export function checkOverline(
  board: BoardState,
  row: number,
  col: number,
): boolean {
  for (let i = 0; i < 4; i++) {
    const pair = DIRECTION_PAIRS[i];
    const dir1Index = pair?.[0];
    if (dir1Index === undefined) {
      continue;
    }
    const length = getLineLength(board, row, col, dir1Index, "black");
    if (length >= 6) {
      return true;
    }
  }
  return false;
}

/**
 * 勝利判定
 * @returns 勝利条件を満たす場合true
 */
export function checkWin(
  board: BoardState,
  lastMove: Position,
  color: StoneColor,
): boolean {
  return checkFive(board, lastMove.row, lastMove.col, color);
}
