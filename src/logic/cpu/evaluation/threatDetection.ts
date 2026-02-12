/**
 * 脅威検出
 *
 * 相手の活四・止め四・活三などの脅威を検出
 */

import type { BoardState, Position } from "@/types/game";

import { incrementThreatDetectionCalls } from "@/logic/cpu/profiling/counters";
import {
  checkJumpFour,
  checkJumpThree,
  isValidPosition,
} from "@/logic/renjuRules";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { isNearExistingStone } from "../moveGenerator";
import { findJumpGapPosition } from "../patterns/threatAnalysis";
import { analyzeDirection } from "./directionAnalysis";
import { isValidConsecutiveThree, isValidJumpThree } from "./jumpPatterns";
import { type ThreatInfo, PATTERN_SCORES } from "./patternScores";
import { createsFourThree } from "./tactics";

/**
 * 配列に重複しない位置を追加するヘルパー関数
 */
function addUniquePosition(positions: Position[], pos: Position): void {
  const exists = positions.some((p) => p.row === pos.row && p.col === pos.col);
  if (!exists) {
    positions.push(pos);
  }
}

/**
 * 配列に複数の重複しない位置を追加するヘルパー関数
 */
export function addUniquePositions(
  positions: Position[],
  newPositions: Position[],
): void {
  for (const pos of newPositions) {
    addUniquePosition(positions, pos);
  }
}

/**
 * 活三とミセ手の両方を止める手が存在するかチェック
 */
export function hasDefenseThatBlocksBoth(
  openThrees: Position[],
  mises: Position[],
): boolean {
  return openThrees.some((openThreePos) =>
    mises.some(
      (misePos) =>
        openThreePos.row === misePos.row && openThreePos.col === misePos.col,
    ),
  );
}

/**
 * 複数方向に脅威（活三以上）がある数をカウント
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 脅威がある方向数
 */
export function countThreatDirections(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): number {
  let threatCount = 0;

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

    // 活四 or 止め四
    if (
      pattern.count === 4 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      threatCount++;
      continue;
    }

    // 活三
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty"
    ) {
      // 黒の場合はウソの三かどうかチェック
      if (
        color === "white" ||
        isValidConsecutiveThree(board, row, col, dirIndex)
      ) {
        threatCount++;
        continue;
      }
    }

    // 跳び四をチェック（連続四がない場合のみ）
    if (
      pattern.count !== 4 &&
      checkJumpFour(board, row, col, dirIndex, color)
    ) {
      threatCount++;
      continue;
    }

    // 跳び三をチェック（連続三がない場合のみ）
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, color)
    ) {
      if (color === "white" || isValidJumpThree(board, row, col, dirIndex)) {
        threatCount++;
      }
    }
  }

  return threatCount;
}

/**
 * 複数方向脅威ボーナスを計算
 *
 * @param threatCount 脅威がある方向数
 * @returns ボーナススコア
 */
export function evaluateMultiThreat(threatCount: number): number {
  return threatCount >= 2
    ? PATTERN_SCORES.MULTI_THREAT_BONUS * (threatCount - 1)
    : 0;
}

/**
 * 活四の防御位置を取得（両端の空きマス）
 */
export function getOpenFourDefensePositions(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { row: number; col: number }[] {
  const positions: { row: number; col: number }[] = [];

  // 正方向の端を探す
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 負方向の端を探す
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
 * 活三の防御位置を取得（両端の空きマス＋夏止め位置）
 *
 * 夏止め（natsu-dome）: 活三の片端から一つ飛ばしで石を置き、
 * 相手がどちらに伸ばしても止め四にしかならないようにする防御技。
 * 条件: 片側の beyond がブロック（盤端 or 石あり）なら反対側の beyond に配置可能。
 */
export function getOpenThreeDefensePositions(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { row: number; col: number }[] {
  const positions: { row: number; col: number }[] = [];

  // 正方向の端を探す
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r += dr;
    c += dc;
  }
  const endPosR = r;
  const endPosC = c;
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 負方向の端を探す
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r -= dr;
    c -= dc;
  }
  const endNegR = r;
  const endNegC = c;
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 夏止め位置を検出
  const beyondPosR = endPosR + dr;
  const beyondPosC = endPosC + dc;
  const beyondNegR = endNegR - dr;
  const beyondNegC = endNegC - dc;

  const beyondPosOpen =
    isValidPosition(beyondPosR, beyondPosC) &&
    board[beyondPosR]?.[beyondPosC] === null;
  const beyondNegOpen =
    isValidPosition(beyondNegR, beyondNegC) &&
    board[beyondNegR]?.[beyondNegC] === null;

  // 両方の beyond がブロック → 夏止め済み、どちらに伸ばしても止め四にしかならない
  if (!beyondPosOpen && !beyondNegOpen) {
    return [];
  }

  // 片側の beyond がブロック（盤端 or 石あり）なら反対側に夏止め
  if (beyondPosOpen && !beyondNegOpen) {
    positions.push({ row: beyondPosR, col: beyondPosC });
  }
  if (beyondNegOpen && !beyondPosOpen) {
    positions.push({ row: beyondNegR, col: beyondNegC });
  }

  return positions;
}

/**
 * 跳び三パターンを検出して防御位置を返す
 *
 * 跳び三パターン:
 * - ・●●・●・ (空白, 2石, 空白, 1石, 空白)
 * - ・●・●●・ (空白, 1石, 空白, 2石, 空白)
 *
 * @param board 盤面
 * @param row 起点行
 * @param col 起点列
 * @param dr 行方向
 * @param dc 列方向
 * @param color 石の色
 * @returns 防御位置の配列（跳びの空きマスと両端）
 */
export function detectJumpThreePattern(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { row: number; col: number }[] {
  const positions: { row: number; col: number }[] = [];

  // パターン1: ・●●・●・ (起点が2石の先頭)
  // 位置: [row-dr, col-dc]=空, [row]=色, [row+dr]=色, [row+2dr]=空, [row+3dr]=色, [row+4dr]=空
  const p1_before = { row: row - dr, col: col - dc };
  const p1_second = { row: row + dr, col: col + dc };
  const p1_gap = { row: row + 2 * dr, col: col + 2 * dc };
  const p1_third = { row: row + 3 * dr, col: col + 3 * dc };
  const p1_after = { row: row + 4 * dr, col: col + 4 * dc };

  if (
    isValidPosition(p1_before.row, p1_before.col) &&
    board[p1_before.row]?.[p1_before.col] === null &&
    isValidPosition(p1_second.row, p1_second.col) &&
    board[p1_second.row]?.[p1_second.col] === color &&
    isValidPosition(p1_gap.row, p1_gap.col) &&
    board[p1_gap.row]?.[p1_gap.col] === null &&
    isValidPosition(p1_third.row, p1_third.col) &&
    board[p1_third.row]?.[p1_third.col] === color &&
    isValidPosition(p1_after.row, p1_after.col) &&
    board[p1_after.row]?.[p1_after.col] === null
  ) {
    // 防御位置: 間の空きマスと両端（どれが最善かは探索で決める）
    positions.push(p1_gap, p1_before, p1_after);
  }

  // パターン2: ・●・●●・ (起点が1石)
  // 位置: [row-dr]=空, [row]=色, [row+dr]=空, [row+2dr]=色, [row+3dr]=色, [row+4dr]=空
  const p2_before = { row: row - dr, col: col - dc };
  const p2_gap = { row: row + dr, col: col + dc };
  const p2_second = { row: row + 2 * dr, col: col + 2 * dc };
  const p2_third = { row: row + 3 * dr, col: col + 3 * dc };
  const p2_after = { row: row + 4 * dr, col: col + 4 * dc };

  if (
    isValidPosition(p2_before.row, p2_before.col) &&
    board[p2_before.row]?.[p2_before.col] === null &&
    isValidPosition(p2_gap.row, p2_gap.col) &&
    board[p2_gap.row]?.[p2_gap.col] === null &&
    isValidPosition(p2_second.row, p2_second.col) &&
    board[p2_second.row]?.[p2_second.col] === color &&
    isValidPosition(p2_third.row, p2_third.col) &&
    board[p2_third.row]?.[p2_third.col] === color &&
    isValidPosition(p2_after.row, p2_after.col) &&
    board[p2_after.row]?.[p2_after.col] === null
  ) {
    // 防御位置: 間の空きマスと両端（どれが最善かは探索で決める）
    positions.push(p2_gap, p2_before, p2_after);
  }

  return positions;
}

/**
 * 相手の脅威（活四・活三）を検出
 *
 * @param board 盤面
 * @param opponentColor 相手の色
 * @returns 脅威情報（活四・活三の防御位置）
 */
export function detectOpponentThreats(
  board: BoardState,
  opponentColor: "black" | "white",
): ThreatInfo {
  // プロファイリング: 脅威検出回数をカウント
  incrementThreatDetectionCalls();

  const result: ThreatInfo = {
    openFours: [],
    fours: [],
    openThrees: [],
    mises: [],
  };

  // 相手の石を全て走査
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      if (board[row]?.[col] !== opponentColor) {
        continue;
      }

      // 各方向をチェック
      for (let dirIdx = 0; dirIdx < DIRECTIONS.length; dirIdx++) {
        const direction = DIRECTIONS[dirIdx];
        if (!direction) {
          continue;
        }
        const [dr, dc] = direction;
        const renjuDirIndex = DIRECTION_INDICES[dirIdx] ?? -1;
        const pattern = analyzeDirection(
          board,
          row,
          col,
          dr,
          dc,
          opponentColor,
        );

        // 活四をチェック（両端が空いている4連）
        if (
          pattern.count === 4 &&
          pattern.end1 === "empty" &&
          pattern.end2 === "empty"
        ) {
          // 両端の防御位置を追加
          addUniquePositions(
            result.openFours,
            getOpenFourDefensePositions(board, row, col, dr, dc, opponentColor),
          );
        }

        // 止め四をチェック（片側だけ空いている4連）
        if (
          pattern.count === 4 &&
          ((pattern.end1 === "empty" && pattern.end2 !== "empty") ||
            (pattern.end1 !== "empty" && pattern.end2 === "empty"))
        ) {
          // 空いている側の防御位置を追加（止め四は1点のみ）
          addUniquePositions(
            result.fours,
            getOpenFourDefensePositions(board, row, col, dr, dc, opponentColor),
          );
        }

        // 跳び四をチェック（●●・●● など、連続4石以外のパターン）
        // 跳び四は中の空きを埋めると五連になるため、止め四と同等の脅威
        if (
          pattern.count !== 4 &&
          renjuDirIndex >= 0 &&
          checkJumpFour(board, row, col, renjuDirIndex, opponentColor)
        ) {
          // 跳び四の防御位置は中の空きマス（埋めると五連になる）
          const gapPos = findJumpGapPosition(
            board,
            row,
            col,
            dr,
            dc,
            opponentColor,
          );
          // eslint-disable-next-line max-depth
          if (gapPos) {
            addUniquePosition(result.fours, gapPos);
          }
        }

        // 活三をチェック（両端が空いている3連）
        if (
          pattern.count === 3 &&
          pattern.end1 === "empty" &&
          pattern.end2 === "empty"
        ) {
          // 両端の防御位置を追加
          addUniquePositions(
            result.openThrees,
            getOpenThreeDefensePositions(
              board,
              row,
              col,
              dr,
              dc,
              opponentColor,
            ),
          );
        }

        // 跳び三をチェック（連続3石以外のパターン）
        if (pattern.count < 3) {
          addUniquePositions(
            result.openThrees,
            detectJumpThreePattern(board, row, col, dr, dc, opponentColor),
          );
        }
      }
    }
  }

  // 相手のミセ手（次に四三が作れる位置）を検出
  // 四三を作るには同色石が近くに必要なので、石の近傍のみ走査
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r]?.[c] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, r, c)) {
        continue;
      }
      if (createsFourThree(board, r, c, opponentColor)) {
        result.mises.push({ row: r, col: c });
      }
    }
  }

  return result;
}
