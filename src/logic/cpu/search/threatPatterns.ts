/**
 * 脅威パターンの検出（共通プリミティブ）
 *
 * VCF/VCT探索で共通利用する勝ち手・四の検出・四の防御位置取得関数群。
 *
 * 禁止: vcf, vct からのインポート
 */

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import {
  checkFive,
  checkForbiddenMove,
  checkJumpFour,
  checkJumpThree,
} from "@/logic/renjuRules";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { checkEnds, countLine, getLineEnds } from "../core/lineAnalysis";
import { isNearExistingStone } from "../moveGenerator";
import { findJumpGapPosition } from "../patterns/threatAnalysis";
import { createsFour } from "./threatMoves";

/**
 * 即勝ち手を探す（五連を完成できる位置）
 *
 * 自分の四（棒四・活四・跳び四）が盤上にある場合、
 * 五を打てる位置を返す。見つからなければnull。
 */
export function findWinningMove(
  board: BoardState,
  color: "black" | "white",
): Position | null {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, row, col)) {
        continue;
      }

      const rowArray = board[row];
      if (rowArray) {
        rowArray[col] = color;
      }

      const isFive = checkFive(board, row, col, color);

      if (rowArray) {
        rowArray[col] = null;
      }

      if (isFive) {
        return { row, col };
      }
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

      // 行配列を取得（このセル操作で共通利用）
      const rowArray = board[row];

      // 石を置いて五連・四を一括チェック（place/undoを1回に統合）
      if (rowArray) {
        rowArray[col] = color;
      }

      const isFive = checkFive(board, row, col, color);
      if (isFive) {
        if (rowArray) {
          rowArray[col] = null;
        }
        moves.push({ row, col });
        continue;
      }

      const isFour = createsFour(board, row, col, color);

      if (rowArray) {
        rowArray[col] = null;
      }

      if (!isFour) {
        continue;
      }

      // 禁手チェックは四を作る手だけに限定
      if (color === "black") {
        const forbidden = checkForbiddenMove(board, row, col);
        if (forbidden.isForbidden) {
          continue;
        }
      }

      moves.push({ row, col });
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
export function getFourDefensePosition(
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
  const ends = getLineEnds(board, row, col, dr, dc, color);
  // 止め四（片端のみ空き）= 1点で防御、活四（両端空き）= 防御不可
  return ends.length === 1 ? (ends[0] ?? null) : null;
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

/**
 * 防御手のカウンター脅威をチェック（1パス統合版）
 *
 * 防御石を置いた後、相手側に五連・四・活三ができるかを判定する。
 * checkFive + createsFour + createsOpenThree を個別に呼ぶと12回のライン走査が必要だが、
 * 四と活三を1パスで判定することで走査回数を削減（8回以下）。
 *
 * @param board 盤面（防御石を配置済み）
 * @param row 防御石の行
 * @param col 防御石の列
 * @param opponentColor 防御側の色
 * @returns "win"（五連）| "four"（四）| "three"（活三）| "none"
 */
export function checkDefenseCounterThreat(
  board: BoardState,
  row: number,
  col: number,
  opponentColor: "black" | "white",
): "win" | "four" | "three" | "none" {
  // 五連は色固有ルール（黒の長連など）があるため専用関数を使用
  if (checkFive(board, row, col, opponentColor)) {
    return "win";
  }

  // 四と活三を1パスでチェック
  let hasThree = false;
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
    const count = countLine(board, row, col, dr, dc, opponentColor);

    // 連続四 → 即リターン
    if (count === 4) {
      const { end1Open, end2Open } = checkEnds(
        board,
        row,
        col,
        dr,
        dc,
        opponentColor,
      );
      if (end1Open || end2Open) {
        return "four";
      }
    }

    // 跳び四
    if (
      count !== 4 &&
      checkJumpFour(board, row, col, dirIndex, opponentColor)
    ) {
      return "four";
    }

    // 連続活三
    if (count === 3) {
      const { end1Open, end2Open } = checkEnds(
        board,
        row,
        col,
        dr,
        dc,
        opponentColor,
      );
      if (end1Open && end2Open) {
        hasThree = true;
      }
    }

    // 跳び三
    if (
      !hasThree &&
      count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, opponentColor)
    ) {
      hasThree = true;
    }
  }
  return hasThree ? "three" : "none";
}
