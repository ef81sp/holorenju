/**
 * 戦術評価
 *
 * 禁手追い込み・ミセ手・フクミ手などの戦術的評価
 */

import type { BoardState, Position } from "@/types/game";

import {
  checkForbiddenMove,
  checkJumpFour,
  checkJumpThree,
  getConsecutiveThreeStraightFourPoints,
  getJumpThreeStraightFourPoints,
  isValidPosition,
} from "@/logic/renjuRules";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { hasVCF } from "../search/vcf";
import { analyzeDirection } from "./directionAnalysis";
import { analyzeJumpPatterns } from "./jumpPatterns";
import { PATTERN_SCORES } from "./patternScores";

/**
 * 複数の位置に禁手と非禁手が混在するかチェック
 * 禁手追い込みの判定に使用：片方だけが禁手なら勝ち確定
 */
export function hasMixedForbiddenPoints(
  board: BoardState,
  points: Position[],
): boolean {
  if (points.length === 0) {
    return false;
  }

  let hasForbidden = false;
  let hasNonForbidden = false;

  for (const pos of points) {
    const result = checkForbiddenMove(board, pos.row, pos.col);
    if (result.isForbidden) {
      hasForbidden = true;
    } else {
      hasNonForbidden = true;
    }
    // 両方見つかったら早期リターン
    if (hasForbidden && hasNonForbidden) {
      return true;
    }
  }

  return hasForbidden && hasNonForbidden;
}

/**
 * 達四点の禁手追い込みをチェック
 * 片方だけが禁手なら勝ち確定（黒は禁手でない方を止めるしかないが、白は禁手側から四を作れる）
 */
function checkForbiddenTrap(
  board: BoardState,
  straightFourPoints: Position[],
): number {
  if (straightFourPoints.length !== 2) {
    return 0;
  }
  const [pos0, pos1] = straightFourPoints;
  if (!pos0 || !pos1) {
    return 0;
  }

  const forbidden0 = checkForbiddenMove(board, pos0.row, pos0.col);
  const forbidden1 = checkForbiddenMove(board, pos1.row, pos1.col);

  if (
    (forbidden0.isForbidden && !forbidden1.isForbidden) ||
    (!forbidden0.isForbidden && forbidden1.isForbidden)
  ) {
    return PATTERN_SCORES.FORBIDDEN_TRAP_STRONG;
  }
  return 0;
}

/**
 * 四に対する防御位置を取得
 */
export function getDefensePositions(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
): { row: number; col: number }[] {
  const positions: { row: number; col: number }[] = [];

  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === "white") {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === "white") {
    r -= dr;
    c -= dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  return positions;
}

/**
 * 活三の延長点を取得（両端の空きマス）
 */
export function getExtensionPoints(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
): { row: number; col: number }[] {
  const positions: { row: number; col: number }[] = [];

  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === "white") {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === "white") {
    r -= dr;
    c -= dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  return positions;
}

/**
 * 禁手追い込み評価
 * 白が四や活三を作った時、黒の防御位置が禁手なら高評価
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @returns 禁手追い込みスコア
 */
export function evaluateForbiddenTrap(
  board: BoardState,
  row: number,
  col: number,
): number {
  let trapScore = 0;

  for (let i = 0; i < DIRECTIONS.length; i++) {
    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;
    const dirIndex = DIRECTION_INDICES[i] ?? -1;

    const pattern = analyzeDirection(board, row, col, dr, dc, "white");

    // 四を作った場合
    if (
      pattern.count === 4 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      // 黒の止め位置を特定
      const defensePositions = getDefensePositions(board, row, col, dr, dc);

      // すべての防御位置が禁手ならば白の勝利確定
      let allForbidden = defensePositions.length > 0;
      for (const pos of defensePositions) {
        const forbiddenResult = checkForbiddenMove(board, pos.row, pos.col);
        if (!forbiddenResult.isForbidden) {
          allForbidden = false;
          break;
        }
      }

      if (allForbidden && defensePositions.length > 0) {
        trapScore += PATTERN_SCORES.FORBIDDEN_TRAP_STRONG;
      }
    }

    // 活三を作った場合（次に四になる）
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty"
    ) {
      // 両端の位置をチェック（活三の延長点）
      const extensionPoints = getExtensionPoints(board, row, col, dr, dc);

      for (const pos of extensionPoints) {
        const forbiddenResult = checkForbiddenMove(board, pos.row, pos.col);
        if (forbiddenResult.isForbidden) {
          // 禁手への誘導セットアップ
          trapScore += PATTERN_SCORES.FORBIDDEN_TRAP_SETUP;
        }
      }

      // 達四点（三を四にする点）の一つが禁手なら追い込み成功
      if (dirIndex >= 0) {
        const straightFourPoints = getConsecutiveThreeStraightFourPoints(
          board,
          row,
          col,
          dirIndex,
          "white",
        );
        trapScore += checkForbiddenTrap(board, straightFourPoints);
      }
    }

    // 跳び三を作った場合
    if (dirIndex >= 0 && checkJumpThree(board, row, col, dirIndex, "white")) {
      const straightFourPoints = getJumpThreeStraightFourPoints(
        board,
        row,
        col,
        dirIndex,
        "white",
      );
      // 片方だけが禁手なら勝ち確定（黒は禁手でない方を止めるしかないが、白は禁手側から四を作れる）
      if (hasMixedForbiddenPoints(board, straightFourPoints)) {
        trapScore += PATTERN_SCORES.FORBIDDEN_TRAP_STRONG;
      }
    }
  }

  return trapScore;
}

/**
 * 白の三三・四四パターンをチェック
 * 白には禁手がないため、三三・四四は即勝利となる
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @returns 三三または四四なら true
 */
export function checkWhiteWinningPattern(
  board: BoardState,
  row: number,
  col: number,
): boolean {
  let openThreeCount = 0;
  let fourCount = 0;

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
    const pattern = analyzeDirection(board, row, col, dr, dc, "white");

    // 活三カウント
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty"
    ) {
      openThreeCount++;
    }

    // 四カウント（活四・止め四両方）
    if (
      pattern.count === 4 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      fourCount++;
    }

    // 跳び三をチェック（連続三がない場合のみ）
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, "white")
    ) {
      openThreeCount++;
    }

    // 跳び四をチェック（連続四がない場合のみ）
    if (
      pattern.count !== 4 &&
      checkJumpFour(board, row, col, dirIndex, "white")
    ) {
      fourCount++;
    }
  }

  // 三三（活三2つ以上）または四四（四2つ以上）なら即勝利
  return openThreeCount >= 2 || fourCount >= 2;
}

/**
 * 指定位置に石を置くと四三ができるかチェック
 * 最適化: 盤面を直接変更して元に戻す方式（copyBoard不要）
 */
export function createsFourThree(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  // 盤面を直接変更
  const targetRow = board[row];
  if (targetRow) {
    targetRow[col] = color;
  }

  // 四と有効な活三を同時に作るかチェック
  const jumpResult = analyzeJumpPatterns(board, row, col, color);
  const result = jumpResult.hasFour && jumpResult.hasValidOpenThree;

  // 盤面を元に戻す
  if (targetRow) {
    targetRow[col] = null;
  }

  return result;
}

/**
 * ミセ手判定
 * 次の手で四三が作れる位置かどうかをチェック
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns ミセ手ならtrue
 */
export function isMiseMove(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  // この手の後、周囲に四三が作れる位置があるかチェック
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) {
        continue;
      }
      const nr = row + dr;
      const nc = col + dc;
      if (!isValidPosition(nr, nc)) {
        continue;
      }
      if (board[nr]?.[nc] !== null) {
        continue;
      }

      // 黒の禁手チェック
      if (color === "black") {
        const forbidden = checkForbiddenMove(board, nr, nc);
        if (forbidden.isForbidden) {
          continue;
        }
      }

      // この位置で四三が作れるか
      if (createsFourThree(board, nr, nc, color)) {
        return true;
      }
    }
  }

  return false;
}

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
      const defensePositions: { row: number; col: number }[] = [];

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
