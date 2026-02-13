/**
 * 後続脅威評価
 *
 * 四を作った後の後続脅威やフクミ手の判定
 */

import type { BoardState, Position } from "@/types/game";

import { isValidPosition } from "@/logic/renjuRules";

import { DIRECTIONS } from "../core/constants";
import { hasVCF } from "../search/vcf";
import { analyzeDirection } from "./directionAnalysis";
import { getLineEndPoints } from "./forbiddenTactics";
import { analyzeJumpPatterns } from "./jumpPatterns";

/**
 * 防御位置周辺で四を作れるかチェック
 *
 * @param board 盤面（防御後の状態）
 * @param defensePos 防御位置
 * @param color 攻撃側の色
 * @returns 防御位置周辺に四を作れる場合true
 */
export function canContinueFourAfterDefense(
  board: BoardState,
  defensePos: Position,
  color: "black" | "white",
): boolean {
  for (let searchDr = -1; searchDr <= 1; searchDr++) {
    for (let searchDc = -1; searchDc <= 1; searchDc++) {
      if (searchDr === 0 && searchDc === 0) {
        continue;
      }
      const newRow = defensePos.row + searchDr;
      const newCol = defensePos.col + searchDc;

      if (!isValidPosition(newRow, newCol)) {
        continue;
      }
      if (board[newRow]?.[newCol] !== null) {
        continue;
      }

      // この位置に自分の石を直接置く
      const testRow = board[newRow];
      if (testRow) {
        testRow[newCol] = color;
      }

      const jumpResult = analyzeJumpPatterns(board, newRow, newCol, color);

      // 石を元に戻す
      if (testRow) {
        testRow[newCol] = null;
      }

      // 次の四を作れる（四追いの継続）
      if (jumpResult.hasFour) {
        return true;
      }
    }
  }

  return false;
}

/**
 * フクミ手判定
 * 次の手でVCF（四追い勝ち）があるかどうかをチェック
 *
 * @param board 盤面（石を置いた状態）
 * @param color 石の色
 * @returns フクミ手ならtrue
 */
export function isFukumiMove(
  board: BoardState,
  color: "black" | "white",
): boolean {
  return hasVCF(board, color);
}

/**
 * 四を置いた後に後続脅威があるかチェック
 * 最適化: boardを直接使用し、防御位置のin-place+undoで盤面を復元
 *
 * @param board 盤面（四を置いた状態）
 * @param row 四を置いた行
 * @param col 四を置いた列
 * @param color 石の色
 * @returns 後続脅威があればtrue
 */
export function hasFollowUpThreat(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  const opponentColor = color === "black" ? "white" : "black";

  // 四の防御位置を見つける
  // 各方向で四を形成しているかチェック
  for (const [dr, dc] of DIRECTIONS) {
    const pattern = analyzeDirection(board, row, col, dr, dc, color);

    // 四を形成している場合
    if (
      pattern.count === 4 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      // 防御位置を取得
      const defensePositions = getLineEndPoints(board, row, col, dr, dc, color);

      // 各防御位置について、相手が防御した後も脅威があるかチェック
      for (const defensePos of defensePositions) {
        // 相手の防御を盤面に直接置く
        const defenseRow = board[defensePos.row];
        if (defenseRow) {
          defenseRow[defensePos.col] = opponentColor;
        }

        // 防御後、自分が四を作れる位置があるかチェック
        const canContinue = canContinueFourAfterDefense(
          board,
          defensePos,
          color,
        );

        // 相手の防御を元に戻す
        if (defenseRow) {
          defenseRow[defensePos.col] = null;
        }

        if (canContinue) {
          return true;
        }
      }
    }
  }

  return false;
}
