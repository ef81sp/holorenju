/**
 * VCFパズル用の純粋関数群
 *
 * プレイヤーの攻め手の検証、防御応手の計算、ダミー防御位置の取得を提供する。
 */

import type { BoardState, Position } from "@/types/game";

import { createsFour } from "@/logic/cpu/search/threatMoves";
import {
  findWinningMove,
  getFourDefensePosition,
} from "@/logic/cpu/search/threatPatterns";
import { checkFive } from "@/logic/renjuRules/core";
import { checkForbiddenMove } from "@/logic/renjuRules/forbiddenMoves";

const BOARD_SIZE = 15;

function cloneBoard(board: BoardState): BoardState {
  return board.map((row) => [...row]);
}

/** 盤面上の全勝ち手位置（五連完成位置）を取得する */
function findAllWinPositions(
  board: BoardState,
  color: "black" | "white",
): Position[] {
  const positions: Position[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    const rowArray = board[row];
    if (!rowArray) {
      continue;
    }
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (rowArray[col] !== null) {
        continue;
      }
      rowArray[col] = color;
      if (checkFive(board, row, col, color)) {
        positions.push({ row, col });
      }
      rowArray[col] = null;
    }
  }
  return positions;
}

// ===== validateAttackMove =====

export type AttackMoveResult =
  | { valid: true; type: "five" | "four" }
  | { valid: false; reason: "occupied" | "forbidden" | "not-four" };

/**
 * プレイヤーの手が有効な攻め手か検証する。
 *
 * フロー:
 * 1. セル占有チェック
 * 2. 一時ボードに石を仮配置
 * 3. 五連チェック（五連は常に有効）
 * 4. 黒の場合: 禁手チェック（元盤面で呼ぶ — APIの仕様）
 * 5. 四を作るかチェック（仮配置後の盤面で呼ぶ）
 */
export function validateAttackMove(
  board: BoardState,
  position: Position,
  attackerColor: "black" | "white",
): AttackMoveResult {
  const { row, col } = position;

  // 1. セル占有チェック
  if (board[row]?.[col] !== null) {
    return { valid: false, reason: "occupied" };
  }

  // 2. 一時ボードに石を仮配置
  const tempBoard = cloneBoard(board);
  tempBoard[row]![col] = attackerColor;

  // 3. 五連チェック（五連は禁手に優先）
  if (checkFive(tempBoard, row, col, attackerColor)) {
    return { valid: true, type: "five" };
  }

  // 4. 黒の場合: 禁手チェック（石配置前の元盤面で呼ぶ）
  if (attackerColor === "black") {
    const forbidden = checkForbiddenMove(board, row, col);
    if (forbidden.isForbidden) {
      return { valid: false, reason: "forbidden" };
    }
  }

  // 5. 四を作るかチェック（石配置後の一時ボードで呼ぶ）
  if (createsFour(tempBoard, row, col, attackerColor)) {
    return { valid: true, type: "four" };
  }

  return { valid: false, reason: "not-four" };
}

// ===== getDefenseResponse =====

export type DefenseResponse =
  | { type: "blocked"; position: Position }
  | { type: "counter-five"; defensePos: Position; winPos: Position }
  | { type: "open-four"; winPositions: Position[] }
  | { type: "forbidden-trap" };

/**
 * 四に対する防御応手を計算する。
 *
 * フロー:
 * 1. 防御位置を探す
 * 2. null（活四）→ 両端の勝ち手位置を返す
 * 3. 防御側が黒の場合 → 禁手チェック（禁手陥穽）
 * 4. 防御石を仮配置 → カウンター五連チェック
 * 5. 通常の防御
 */
export function getDefenseResponse(
  board: BoardState,
  lastMove: Position,
  attackerColor: "black" | "white",
): DefenseResponse {
  const opponentColor = attackerColor === "black" ? "white" : "black";

  // 1. 防御位置を探す
  const defensePos = getFourDefensePosition(board, lastMove, attackerColor);

  // 2. null = 活四（防御不能）
  if (defensePos === null) {
    const winPositions = findAllWinPositions(board, attackerColor);
    return { type: "open-four", winPositions };
  }

  // 3. 防御側が黒の場合、禁手チェック
  if (opponentColor === "black") {
    const forbidden = checkForbiddenMove(board, defensePos.row, defensePos.col);
    if (forbidden.isForbidden) {
      return { type: "forbidden-trap" };
    }
  }

  // 4. 防御石を仮配置してカウンター五連チェック
  const tempBoard = cloneBoard(board);
  tempBoard[defensePos.row]![defensePos.col] = opponentColor;

  const winPos = findWinningMove(tempBoard, opponentColor);
  if (winPos) {
    return { type: "counter-five", defensePos, winPos };
  }

  // 5. 通常の防御
  return { type: "blocked", position: defensePos };
}

// ===== hasRemainingAttacks =====

/**
 * プレイヤーに有効な攻め手（四または五を作れる手）が残っているか判定する。
 */
export function hasRemainingAttacks(
  board: BoardState,
  attackerColor: "black" | "white",
): boolean {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== null) {
        continue;
      }
      const result = validateAttackMove(board, { row, col }, attackerColor);
      if (result.valid) {
        return true;
      }
    }
  }
  return false;
}

// ===== findDummyDefensePosition =====

/**
 * 活四時のダミー応手位置を取得する。
 * 勝ち手2箇所を除外した空きセルを返す。
 */
export function findDummyDefensePosition(
  board: BoardState,
  winPositions: Position[],
): Position | null {
  const winSet = new Set(winPositions.map((p) => `${p.row},${p.col}`));
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] === null && !winSet.has(`${row},${col}`)) {
        return { row, col };
      }
    }
  }
  return null;
}
