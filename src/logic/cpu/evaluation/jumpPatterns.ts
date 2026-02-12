/**
 * 跳びパターン分析
 *
 * 跳び三・跳び四のパターン検出と評価
 */

import type { BoardState } from "@/types/game";

import {
  checkForbiddenMove,
  checkJumpFour,
  checkJumpThree,
  getConsecutiveThreeStraightFourPoints,
  getJumpThreeStraightFourPoints,
} from "@/logic/renjuRules";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { analyzeDirection } from "./directionAnalysis";
import { type JumpPatternResult, PATTERN_SCORES } from "./patternScores";

/**
 * 連続三が有効（ウソの三でない）かをチェック
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param dirIndex renjuRules.tsのDIRECTIONSに対応する方向インデックス
 * @returns 三が有効ならtrue
 */
export function isValidConsecutiveThree(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
): boolean {
  const straightFourPoints = getConsecutiveThreeStraightFourPoints(
    board,
    row,
    col,
    dirIndex,
  );

  if (straightFourPoints.length === 0) {
    return false;
  }

  for (const pos of straightFourPoints) {
    const result = checkForbiddenMove(board, pos.row, pos.col);
    if (!result.isForbidden) {
      return true;
    }
  }
  return false;
}

/**
 * 跳び三が有効（ウソの三でない）かをチェック
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param dirIndex renjuRules.tsのDIRECTIONSに対応する方向インデックス
 * @returns 三が有効ならtrue
 */
export function isValidJumpThree(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
): boolean {
  const straightFourPoints = getJumpThreeStraightFourPoints(
    board,
    row,
    col,
    dirIndex,
  );

  if (straightFourPoints.length === 0) {
    return false;
  }

  for (const pos of straightFourPoints) {
    const result = checkForbiddenMove(board, pos.row, pos.col);
    if (!result.isForbidden) {
      return true;
    }
  }
  return false;
}

/**
 * 跳びパターン（跳び三・跳び四）を分析
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 跳びパターンの分析結果
 */
export function analyzeJumpPatterns(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): JumpPatternResult {
  const result: JumpPatternResult = {
    hasFour: false,
    jumpFourCount: 0,
    hasOpenFour: false,
    hasJumpThree: false,
    hasValidOpenThree: false,
  };

  // まず各方向の跳び四を先にチェックして記録
  // 同じ方向に跳び四がある場合、連続三を活三としてカウントしないため
  const jumpFourDirections = new Set<number>();

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

    // 連続四がなく、跳び四がある場合を記録
    if (
      pattern.count !== 4 &&
      checkJumpFour(board, row, col, dirIndex, color)
    ) {
      jumpFourDirections.add(i);
    }
  }

  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) {
      continue;
    }

    // 連続パターンを先にチェック（DIRECTIONSの順に）
    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);

    // 連続四をチェック（少なくとも片端が空いていなければ五を作れないため除外）
    if (
      pattern.count === 4 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      result.hasFour = true;
      if (pattern.end1 === "empty" && pattern.end2 === "empty") {
        result.hasOpenFour = true;
      }
    }

    // 連続三をチェック（活三）
    // ただし、同じ方向に跳び四がある場合は活三としてカウントしない
    // （その方向は「四を作る」方向であり「活三を作る」方向ではない）
    if (pattern.count === 3 && !jumpFourDirections.has(i)) {
      if (pattern.end1 === "empty" && pattern.end2 === "empty") {
        if (
          color === "white" ||
          isValidConsecutiveThree(board, row, col, dirIndex)
        ) {
          result.hasValidOpenThree = true;
        }
      }
    }

    // 跳び四をチェック（連続四がない場合のみ）
    if (jumpFourDirections.has(i)) {
      result.hasFour = true;
      result.jumpFourCount++;
      // 跳び四は両端開の形がないので、常に止め四扱い
    }

    // 跳び三をチェック（連続三がない場合のみ）
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, color)
    ) {
      result.hasJumpThree = true;
      // 白番ならウソの三チェック不要、黒番なら達四点が禁点でないかチェック
      if (color === "white" || isValidJumpThree(board, row, col, dirIndex)) {
        result.hasValidOpenThree = true;
      }
    }
  }

  return result;
}

/**
 * 跳びパターンからスコアを計算
 *
 * @param jumpResult 跳びパターンの分析結果
 * @returns スコア
 */
export function getJumpPatternScore(jumpResult: JumpPatternResult): number {
  let score = 0;

  // 跳び四のスコア（連続四はanalyzeDirectionでカウント済みなので、跳び四のみ）
  // 跳び四は止め四と同等のスコア（FOURスコア）
  score += jumpResult.jumpFourCount * PATTERN_SCORES.FOUR;

  // 有効な活跳び三のスコア（hasValidOpenThreeは連続三・跳び三両方を含むが、
  // 連続三のスコアはanalyzeDirectionでカウント済みなので、跳び三のみ追加）
  if (jumpResult.hasJumpThree && jumpResult.hasValidOpenThree) {
    score += PATTERN_SCORES.OPEN_THREE;
  }

  return score;
}
