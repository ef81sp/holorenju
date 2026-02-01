/**
 * VCT（Victory by Continuous Threats）探索
 *
 * 三・四を連続して打つことで勝利する手順を探索する。
 * VCF（四連続）はVCTの部分集合なので、VCFがあればVCTも成立。
 */

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import {
  checkFive,
  checkForbiddenMove,
  checkJumpFour,
  checkJumpThree,
  copyBoard,
} from "@/logic/renjuRules";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { checkEnds, countLine, getLineEnds } from "../core/lineAnalysis";
import { isNearExistingStone } from "../moveGenerator";
import {
  findJumpGapPosition,
  getJumpThreeDefensePositions,
} from "../patterns/threatAnalysis";
import { hasVCF } from "./vcf";

/** VCT探索の最大深度 */
const VCT_MAX_DEPTH = 4;

/** VCT探索を有効にする石数の閾値（終盤のみ） */
export const VCT_STONE_THRESHOLD = 20;

/**
 * VCT（三・四連続勝ち）が成立するかチェック
 *
 * @param board 盤面
 * @param color 手番
 * @param depth 現在の探索深度
 * @returns VCTが成立する場合true
 */
export function hasVCT(
  board: BoardState,
  color: "black" | "white",
  depth = 0,
): boolean {
  if (depth >= VCT_MAX_DEPTH) {
    return false;
  }

  // VCFがあればVCT成立（VCF ⊂ VCT）
  if (hasVCF(board, color)) {
    return true;
  }

  // 脅威（四・活三）を作れる位置を列挙
  const threatMoves = findThreatMoves(board, color);

  for (const move of threatMoves) {
    // 脅威を作る
    const afterThreat = copyBoard(board);
    const afterThreatRow = afterThreat[move.row];
    if (afterThreatRow) {
      afterThreatRow[move.col] = color;
    }

    // 五連チェック
    if (checkFive(afterThreat, move.row, move.col, color)) {
      return true;
    }

    // 相手の防御位置を列挙
    const defensePositions = getThreatDefensePositions(
      afterThreat,
      move.row,
      move.col,
      color,
    );

    // 防御不可（活四など）= 勝利
    if (defensePositions.length === 0) {
      // 脅威が成立しているか再確認（四または活三）
      if (isThreat(afterThreat, move.row, move.col, color)) {
        return true;
      }
      continue;
    }

    // 全ての防御に対してVCTが継続できるか
    let allDefenseLeadsToVCT = true;
    for (const defensePos of defensePositions) {
      // 白番の場合、黒の防御位置が禁手ならVCT成立
      if (color === "white") {
        const forbiddenResult = checkForbiddenMove(
          afterThreat,
          defensePos.row,
          defensePos.col,
        );
        if (forbiddenResult.isForbidden) {
          continue;
        }
      }

      // 相手が防御した後の局面
      const afterDefense = copyBoard(afterThreat);
      const opponentColor = color === "black" ? "white" : "black";
      const afterDefenseRow = afterDefense[defensePos.row];
      if (afterDefenseRow) {
        afterDefenseRow[defensePos.col] = opponentColor;
      }

      // 再帰的にVCTをチェック
      if (!hasVCT(afterDefense, color, depth + 1)) {
        allDefenseLeadsToVCT = false;
        break;
      }
    }

    if (allDefenseLeadsToVCT && defensePositions.length > 0) {
      return true;
    }
  }

  return false;
}

/**
 * 脅威（四・活三）を作れる位置を列挙
 * 四を優先的に列挙（枝刈り効率のため）
 */
function findThreatMoves(
  board: BoardState,
  color: "black" | "white",
): Position[] {
  const fourMoves: Position[] = [];
  const openThreeMoves: Position[] = [];

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
          fourMoves.push({ row, col });
          continue;
        }

        const forbidden = checkForbiddenMove(board, row, col);
        if (forbidden.isForbidden) {
          continue;
        }
      }

      // 仮想的に石を置く
      const testBoard = copyBoard(board);
      const testRow = testBoard[row];
      if (testRow) {
        testRow[col] = color;
      }

      // 四が作れるかチェック
      if (createsFour(testBoard, row, col, color)) {
        fourMoves.push({ row, col });
        continue;
      }

      // 活三が作れるかチェック
      if (createsOpenThree(testBoard, row, col, color)) {
        openThreeMoves.push({ row, col });
      }
    }
  }

  // 四を優先して返す
  return [...fourMoves, ...openThreeMoves];
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
      const { end1Open, end2Open } = checkEnds(board, row, col, dr, dc, color);
      if (end1Open || end2Open) {
        return true;
      }
    }

    // 跳び四をチェック
    if (count !== 4 && checkJumpFour(board, row, col, dirIndex, color)) {
      return true;
    }
  }

  return false;
}

/**
 * 指定位置に石を置くと活三ができるかチェック
 */
function createsOpenThree(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
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

    // 連続三をチェック
    const count = countLine(board, row, col, dr, dc, color);
    if (count === 3) {
      const { end1Open, end2Open } = checkEnds(board, row, col, dr, dc, color);
      if (end1Open && end2Open) {
        return true;
      }
    }

    // 跳び三をチェック
    if (count !== 3 && checkJumpThree(board, row, col, dirIndex, color)) {
      return true;
    }
  }

  return false;
}

/**
 * 脅威が成立しているかチェック（四または活三）
 */
function isThreat(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  return (
    createsFour(board, row, col, color) ||
    createsOpenThree(board, row, col, color)
  );
}

/**
 * 脅威に対する防御位置を取得
 *
 * - 活四: 防御不可（空配列）
 * - 止め四: 1点
 * - 活三: 両端の2点
 */
function getThreatDefensePositions(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  const defensePositions: Position[] = [];

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
      const ends = getLineEnds(board, row, col, dr, dc, color);

      // 活四（両端開き）= 防御不可
      if (ends.length === 2) {
        return [];
      }

      // 止め四 = 1点で防御
      if (ends.length === 1 && ends[0]) {
        defensePositions.push(ends[0]);
      }
    }

    // 跳び四をチェック
    if (count !== 4 && checkJumpFour(board, row, col, dirIndex, color)) {
      const jumpGap = findJumpGapPosition(board, row, col, dr, dc, color);
      if (jumpGap) {
        defensePositions.push(jumpGap);
      }
    }

    // 活三をチェック
    if (count === 3) {
      const { end1Open, end2Open } = checkEnds(board, row, col, dr, dc, color);
      if (end1Open && end2Open) {
        const ends = getLineEnds(board, row, col, dr, dc, color);
        defensePositions.push(...ends);
      }
    }

    // 跳び三をチェック
    if (count !== 3 && checkJumpThree(board, row, col, dirIndex, color)) {
      const ends = getJumpThreeDefensePositions(board, row, col, dr, dc, color);
      defensePositions.push(...ends);
    }
  }

  // 重複を除去
  const unique = new Map<string, Position>();
  for (const pos of defensePositions) {
    const key = `${pos.row},${pos.col}`;
    if (!unique.has(key)) {
      unique.set(key, pos);
    }
  }

  return Array.from(unique.values());
}

// 後方互換性のため core/boardUtils から再export
export { countStones } from "../core/boardUtils";
