/**
 * 脅威パターンの検出（共通プリミティブ）
 *
 * VCF/VCT探索で共通利用する勝ち手・四の検出・四の防御位置取得関数群。
 *
 * 禁止: vcf, vct からのインポート
 */

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import { checkFive } from "@/logic/renjuRules";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import {
  checkEnds,
  checkEndsForFour,
  collectLineFivePoints,
  countLine,
  getLineEnds,
} from "../core/lineAnalysis";
// 夏止め済み判定（受け点の基準と活三判定を一致させる SSoT）
import { getOpenThreeDefensePositions } from "../evaluation/threatDetection";
import { isNearExistingStone } from "../moveGenerator";
import { findJumpGapPosition } from "../patterns/threatAnalysis";
// #43 PR-3: 図形/禁手の葉プリミティブを Zig アダプタへ委譲（patterns.ts/forbiddenMoves.ts 依存を断つ）。
import { isForbiddenForBlack } from "../wasm/forbiddenAdapter";
import { checkJumpFour, checkJumpThree } from "../wasm/patternsAdapter";
import { createsFour, isJumpFourOverline } from "./threatMoves";

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
      if (color === "black" && isForbiddenForBlack(board, row, col)) {
        continue;
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
 * 方向ごとに `collectLineFivePoints` で「その方向で埋めると五になる点」を列挙する
 * （受け点の SSoT。Zig 側 `quiescence.getFourDefensePosition` と同じ基準）。
 * - 五点 0 個: この方向は四ではない（黒の長連にしかならない四）→ 無視
 * - 五点 2 個以上: 両方は塞げない ＝ 活四（防御不可）→ null
 * - 五点 1 個: 止め四。その点が受け
 *
 * issue #115: 以前は跳び四で `findJumpGapPosition` の返り値を検証せずに使っており、
 * 同一ライン上に長連ギャップと正当なギャップが併存すると長連ギャップを返していた。
 * また連続四では `getLineEnds` の両端空きを無条件に活四としており、黒の片端が
 * 長連になる `_XXXX_`（実際は止め四で受けられる）を防御不可と誤判定していた。
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
  let firstDefense: Position | null = null;

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

    const isConsecutiveFour = countLine(board, row, col, dr, dc, color) === 4;
    if (
      !isConsecutiveFour &&
      !checkJumpFour(board, row, col, dirIndex, color)
    ) {
      continue;
    }

    // 連続四・跳び四を区別せず、その方向で「埋めると五になる点」を列挙して判定する。
    const fivePoints = collectLineFivePoints(board, row, col, dr, dc, color);
    if (fivePoints.length === 0) {
      // この方向は四ではない（黒の長連にしかならない四）
      continue;
    }
    if (fivePoints.length >= 2) {
      // 両方は塞げない = 活四（防御不可能）
      return null;
    }
    if (!firstDefense) {
      firstDefense = fivePoints[0] ?? null;
    }
  }

  return firstDefense;
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

    // 連続四 → 即リターン（黒は長連チェック付き）
    if (count === 4) {
      const { end1Open, end2Open } = checkEndsForFour(
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
      if (!isJumpFourOverline(board, row, col, dr, dc, opponentColor)) {
        return "four";
      }
    }

    // 連続活三
    // 夏止め済み（両外側ブロックで活四にできない三）は本物のカウンター脅威でないため除外。
    // 受け点の基準（getOpenThreeDefensePositions: 空リスト=夏止め済み）と揃える（classifyThreat と同基準）。
    if (!hasThree && count === 3) {
      const { end1Open, end2Open } = checkEnds(
        board,
        row,
        col,
        dr,
        dc,
        opponentColor,
      );
      if (
        end1Open &&
        end2Open &&
        getOpenThreeDefensePositions(board, row, col, dr, dc, opponentColor)
          .length > 0
      ) {
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
