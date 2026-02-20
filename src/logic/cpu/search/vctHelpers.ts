/**
 * VCT探索のヘルパー関数
 *
 * VCT探索で使用する脅威検出・防御位置取得の非再帰ヘルパー群。
 *
 * 禁止: vct からのインポート
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
import { analyzeDirection } from "../evaluation/directionAnalysis";
import {
  isValidConsecutiveThree,
  isValidJumpThree,
} from "../evaluation/jumpPatterns";
import { getOpenThreeDefensePositions } from "../evaluation/threatDetection";
import { isNearExistingStone } from "../moveGenerator";
import {
  findJumpGapPosition,
  getJumpThreeDefensePositions,
} from "../patterns/threatAnalysis";
import { classifyThreat } from "./threatMoves";

/**
 * 指定色が活三（連続三で両端空き）を持っているかチェック
 *
 * 活三を持つ相手がいる場合、相手は三を無視して四を打てるため、
 * VCT（三を含む脅威連続）は成立しない。VCF（四追い）のみが有効。
 *
 * @param board 盤面
 * @param color チェック対象の色
 * @returns 活三があればtrue
 */
export function hasOpenThree(
  board: BoardState,
  color: "black" | "white",
): boolean {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== color) {
        continue;
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
        const pattern = analyzeDirection(board, row, col, dr, dc, color);
        // 連続活三
        if (
          pattern.count === 3 &&
          pattern.end1 === "empty" &&
          pattern.end2 === "empty"
        ) {
          return true;
        }
        // 跳び三（○○_○ や ○_○○）
        if (
          pattern.count !== 3 &&
          checkJumpThree(board, row, col, dirIndex, color)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * 脅威（四・活三）を作れる位置を列挙
 * 四を優先的に列挙（枝刈り効率のため）
 */
export function findThreatMoves(
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

      // 行配列を取得
      const rowArray = board[row];

      // インプレースで石を置いて五連・四・活三を一括チェック
      if (rowArray) {
        rowArray[col] = color;
      }

      // 五連が作れる場合は最優先（禁手でもOK）
      if (checkFive(board, row, col, color)) {
        if (rowArray) {
          rowArray[col] = null;
        }
        fourMoves.push({ row, col });
        continue;
      }

      // 四と活三を1パスで判定
      const threat = classifyThreat(board, row, col, color);

      // 元に戻す（Undo）
      if (rowArray) {
        rowArray[col] = null;
      }

      if (!threat.createsFour && !threat.createsOpenThree) {
        continue;
      }

      // 禁手チェックは脅威を作る手だけに限定
      if (
        color === "black" &&
        checkForbiddenMove(board, row, col).isForbidden
      ) {
        continue;
      }

      if (threat.createsFour) {
        fourMoves.push({ row, col });
      } else {
        openThreeMoves.push({ row, col });
      }
    }
  }

  // 四を優先して返す
  return [...fourMoves, ...openThreeMoves];
}

/**
 * 脅威が成立しているかチェック（四または活三）
 */
export function isThreat(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  const result = classifyThreat(board, row, col, color);
  return result.createsFour || result.createsOpenThree;
}

/**
 * 脅威に対する防御位置を取得
 *
 * - 活四: 防御不可（空配列）
 * - 止め四: 1点
 * - 活三: 両端の2点
 */
/** @internal テスト用にエクスポート */
export function getThreatDefensePositions(
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

/**
 * 指定位置に石を置いた際に作られた活三/飛び三の防御位置を返す
 *
 * Mise-VCFのノリ手検証で使用。ミセ手は必ず三に含まれるため、
 * 4方向チェックで十分（全盤面スキャン不要）。
 */
export function getCreatedOpenThreeDefenses(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  const defenses: Position[] = [];
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
    const pattern = analyzeDirection(board, row, col, dr, dc, color);
    // 連続活三（黒の場合はウソの三を除外）
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty" &&
      (color !== "black" || isValidConsecutiveThree(board, row, col, dirIndex))
    ) {
      defenses.push(
        ...getOpenThreeDefensePositions(board, row, col, dr, dc, color),
      );
    }
    // 飛び三（黒の場合はウソの三を除外）
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, color) &&
      (color !== "black" || isValidJumpThree(board, row, col, dirIndex))
    ) {
      defenses.push(
        ...getJumpThreeDefensePositions(board, row, col, dr, dc, color),
      );
    }
  }
  // 重複除去 + 空きマスのみ
  const unique = new Map<string, Position>();
  for (const pos of defenses) {
    if (board[pos.row]?.[pos.col] !== null) {
      continue;
    }
    const key = `${pos.row},${pos.col}`;
    if (!unique.has(key)) {
      unique.set(key, pos);
    }
  }
  return Array.from(unique.values());
}
