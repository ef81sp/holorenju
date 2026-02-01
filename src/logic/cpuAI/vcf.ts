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

import { DIRECTION_INDICES, DIRECTIONS } from "./core/constants";
import { checkEnds, countLine } from "./core/lineAnalysis";
import { isNearExistingStone } from "./moveGenerator";

// 後方互換性のためライン解析関数を再export
export { checkEnds, countLine } from "./core/lineAnalysis";

/** VCF探索の最大深度 */
const VCF_MAX_DEPTH = 8;

/**
 * VCFが成立するかチェック
 *
 * @param board 盤面
 * @param color 手番
 * @param depth 現在の探索深度
 * @returns VCFが成立する場合true
 */
export function hasVCF(
  board: BoardState,
  color: "black" | "white",
  depth = 0,
): boolean {
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

    if (hasVCF(afterDefense, color, depth + 1)) {
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

  for (const move of fourMoves) {
    // 四を作る
    const afterFour = copyBoard(board);
    const afterFourRow = afterFour[move.row];
    if (afterFourRow) {
      afterFourRow[move.col] = color;
    }

    // 五連チェック
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

      // 黒の禁手チェック
      if (color === "black") {
        // 五連が作れる場合は禁手でも候補に含める
        if (checkFive(board, row, col, "black")) {
          moves.push({ row, col });
          continue;
        }

        const forbidden = checkForbiddenMove(board, row, col);
        if (forbidden.isForbidden) {
          continue;
        }
      }

      // 四が作れるかチェック
      if (createsFour(board, row, col, color)) {
        moves.push({ row, col });
      }
    }
  }

  return moves;
}

/**
 * 指定位置に石を置くと四ができるかチェック
 */
function createsFour(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  // 仮想的に石を置く
  const testBoard = copyBoard(board);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = color;
  }

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
    const count = countLine(testBoard, row, col, dr, dc, color);
    if (count === 4) {
      // 片方でも開いていれば四
      const { end1Open, end2Open } = checkEnds(
        testBoard,
        row,
        col,
        dr,
        dc,
        color,
      );
      if (end1Open || end2Open) {
        return true;
      }
    }

    // 跳び四をチェック
    if (count !== 4 && checkJumpFour(testBoard, row, col, dirIndex, color)) {
      return true;
    }
  }

  return false;
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
  // ラインをスキャンして空きマスを探す
  const linePositions: { pos: Position; stone: "black" | "white" | null }[] =
    [];

  // 負方向に5マス
  for (let i = 5; i >= 1; i--) {
    const pr = row - dr * i;
    const pc = col - dc * i;
    if (isValidPosition(pr, pc)) {
      linePositions.push({
        pos: { row: pr, col: pc },
        stone: board[pr]?.[pc] ?? null,
      });
    }
  }

  // 置いた位置
  linePositions.push({
    pos: { row, col },
    stone: color,
  });

  // 正方向に5マス
  for (let i = 1; i <= 5; i++) {
    const pr = row + dr * i;
    const pc = col + dc * i;
    if (isValidPosition(pr, pc)) {
      linePositions.push({
        pos: { row: pr, col: pc },
        stone: board[pr]?.[pc] ?? null,
      });
    }
  }

  // 跳び四パターンを探して空きマスを特定
  // パターン1: ●●●・● (3連 + 空 + 1)
  // パターン2: ●●・●● (2連 + 空 + 2連)
  // パターン3: ●・●●● (1 + 空 + 3連)
  for (let start = 0; start <= linePositions.length - 5; start++) {
    const segment = linePositions.slice(start, start + 5);
    if (segment.length !== 5) {
      continue;
    }

    const stones = segment.map((s) => s.stone);
    const positions = segment.map((s) => s.pos);

    // パターン1: ●●●・●
    if (
      stones[0] === color &&
      stones[1] === color &&
      stones[2] === color &&
      stones[3] === null &&
      stones[4] === color
    ) {
      return positions[3] ?? null;
    }

    // パターン2: ●●・●●
    if (
      stones[0] === color &&
      stones[1] === color &&
      stones[2] === null &&
      stones[3] === color &&
      stones[4] === color
    ) {
      return positions[2] ?? null;
    }

    // パターン3: ●・●●●
    if (
      stones[0] === color &&
      stones[1] === null &&
      stones[2] === color &&
      stones[3] === color &&
      stones[4] === color
    ) {
      return positions[1] ?? null;
    }
  }

  return null;
}
