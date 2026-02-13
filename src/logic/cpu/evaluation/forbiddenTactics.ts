/**
 * 禁手追い込み戦術
 *
 * 白が禁手を利用して黒を追い込む戦術と、
 * 黒の禁手脆弱性（追い込まれやすさ）の評価
 */

import type { BoardState, Position } from "@/types/game";

import {
  checkForbiddenMove,
  checkJumpThree,
  getConsecutiveThreeStraightFourPoints,
  getJumpThreeStraightFourPoints,
  isValidPosition,
} from "@/logic/renjuRules";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { analyzeDirection } from "./directionAnalysis";
import { PATTERN_SCORES } from "./patternScores";

/**
 * ライン端点を取得（指定色の石を辿り、両端の空きマスを返す）
 *
 * getDefensePositions / getExtensionPoints / getBlackExtensionPoints を統合した汎用版。
 * 四に対する防御位置の取得、活三の延長点の取得に使用。
 */
export function getLineEndPoints(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): Position[] {
  const positions: Position[] = [];

  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r -= dr;
    c -= dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  return positions;
}

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
      const defensePositions = getLineEndPoints(
        board,
        row,
        col,
        dr,
        dc,
        "white",
      );

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
      const extensionPoints = getLineEndPoints(
        board,
        row,
        col,
        dr,
        dc,
        "white",
      );

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
 * 延長点方向に白石があるかチェック
 *
 * 延長点の先に白石がある場合、白がその方向から攻撃する可能性が高い。
 */
function hasWhiteStoneNearExtension(
  board: BoardState,
  extRow: number,
  extCol: number,
  dr: number,
  dc: number,
): boolean {
  // 延長点の先2マスをチェック
  for (let step = 1; step <= 2; step++) {
    const r = extRow + dr * step;
    const c = extCol + dc * step;
    if (!isValidPosition(r, c)) {
      break;
    }
    if (board[r]?.[c] === "white") {
      return true;
    }
  }
  return false;
}

/**
 * 黒の禁手脆弱性を評価（ルートレベル専用）
 *
 * 黒の着手後、自分のパターン延長点が禁手かをチェック。
 * 延長点が禁手 = 白の追い込みターゲットになりうる。
 *
 * @param board 盤面（黒の石を置いた状態）
 * @param row 黒が置いた行
 * @param col 黒が置いた列
 * @returns 脆弱性ペナルティ（0以上、大きいほど危険）
 */
export function evaluateForbiddenVulnerability(
  board: BoardState,
  row: number,
  col: number,
): number {
  let totalPenalty = 0;

  for (let i = 0; i < DIRECTIONS.length; i++) {
    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;
    const dirIndex = DIRECTION_INDICES[i] ?? -1;

    const pattern = analyzeDirection(board, row, col, dr, dc, "black");

    // 連続三を検出した場合
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty"
    ) {
      const extensionPoints = getLineEndPoints(
        board,
        row,
        col,
        dr,
        dc,
        "black",
      );

      for (const pos of extensionPoints) {
        const forbiddenResult = checkForbiddenMove(board, pos.row, pos.col);
        if (forbiddenResult.isForbidden) {
          const hasWhite = hasWhiteStoneNearExtension(
            board,
            pos.row,
            pos.col,
            dr,
            dc,
          );
          totalPenalty += hasWhite
            ? PATTERN_SCORES.FORBIDDEN_VULNERABILITY_STRONG
            : PATTERN_SCORES.FORBIDDEN_VULNERABILITY_MILD;
        }
      }
    }

    // 跳び三も検出（analyzeDirection は連続パターンのみ）
    if (
      dirIndex >= 0 &&
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, "black")
    ) {
      const straightFourPoints = getJumpThreeStraightFourPoints(
        board,
        row,
        col,
        dirIndex,
        "black",
      );

      for (const pos of straightFourPoints) {
        const forbiddenResult = checkForbiddenMove(board, pos.row, pos.col);
        if (forbiddenResult.isForbidden) {
          const hasWhite = hasWhiteStoneNearExtension(
            board,
            pos.row,
            pos.col,
            dr,
            dc,
          );
          totalPenalty += hasWhite
            ? PATTERN_SCORES.FORBIDDEN_VULNERABILITY_STRONG
            : PATTERN_SCORES.FORBIDDEN_VULNERABILITY_MILD;
        }
      }
    }

    // ペナルティ上限に達したら早期終了
    if (totalPenalty >= PATTERN_SCORES.FORBIDDEN_VULNERABILITY_CAP) {
      return PATTERN_SCORES.FORBIDDEN_VULNERABILITY_CAP;
    }
  }

  return Math.min(totalPenalty, PATTERN_SCORES.FORBIDDEN_VULNERABILITY_CAP);
}
