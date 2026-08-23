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
import { checkEnds, countLine } from "../core/lineAnalysis";
// 夏止め済み判定（受け点の基準と活三判定を一致させる SSoT）
import { getOpenThreeDefensePositions } from "../evaluation/threatDetection";
import { isNearExistingStone } from "../moveGenerator";
// #43 PR-3: 図形/禁手の葉プリミティブを Zig アダプタへ委譲（patterns.ts/forbiddenMoves.ts 依存を断つ）。
import { isForbiddenForBlack } from "../wasm/forbiddenAdapter";
import { checkJumpThree } from "../wasm/patternsAdapter";
import {
  type FourClass,
  FOUR_CLASS_NOT_FOUR,
  classifyFourInDirection,
  createsFour,
  isFourInDirection,
} from "./threatMoves";

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
 * `getFourDefensePosition` の結果（issue #124 で 3 値化）
 *
 * 以前は `Position | null` で、`null` が「防御不可（活四）」と「そもそも四ではない」の
 * 両方を意味していた。VCF 経路は `null` を即勝ちとして扱うため、四の判定側が
 * 偽陽性を出すと「四ですらない手」で VCF が成立してしまっていた。
 *
 * issue #134: 方向ごとの分類（`threatMoves.FourClass`）と**同じ型**にした。
 * 3 値の意味も一致する（`not_four` = 五点 0 個 / `unstoppable` = 活四で 1 手では
 * 止められない / `block` = 止め四でその 1 点が受け）。畳み込み後は「どの方向の
 * 五点か」が意味を持たないので `unstoppable.fivePoints` は付けない（optional）。
 * Zig 側の `quiescence.FourDefense = threats.FourClass` と対称。
 */
export type FourDefense = FourClass;

export const FOUR_DEFENSE_NOT_FOUR: FourDefense = FOUR_CLASS_NOT_FOUR;
export const FOUR_DEFENSE_UNSTOPPABLE: FourDefense = Object.freeze({
  kind: "unstoppable",
});

/**
 * 受け点があれば返す。`not_four` / `unstoppable` はどちらも `null`。
 *
 * 「四なら必ず受ける／それ以外は保守的に打ち切る」呼び出し側（VCT 検証）向け。
 * VCF 経路では `unstoppable` だけが勝ちなので、この関数を使ってはならない。
 */
export function fourDefenseBlock(defense: FourDefense): Position | null {
  return defense.kind === "block" ? defense.position : null;
}

/**
 * 四に対する防御位置を取得
 * 四は1点でしか止められないので、その位置を返す
 *
 * 方向ごとの分類（`classifyFourInDirection` ＝ 四判定・受け点の SSoT・issue #134）を
 * 4 方向で畳み込む（Zig 側 `quiescence.getFourDefensePosition` と同じ基準）。
 * - `not_four`: この方向は四ではない（黒の長連にしかならない四）→ 無視
 * - `unstoppable`: 両方は塞げない ＝ 活四（防御不可）→ 即返す
 * - `block`: 止め四。その点が受け（複数方向あれば最初の 1 点）
 * - どの方向も四でなかった → `not_four`
 *
 * issue #115: 以前は跳び四で `findJumpGapPosition` の返り値を検証せずに使っており、
 * 同一ライン上に長連ギャップと正当なギャップが併存すると長連ギャップを返していた。
 * また連続四では `getLineEnds` の両端空きを無条件に活四としており、黒の片端が
 * 長連になる `_XXXX_`（実際は止め四で受けられる）を防御不可と誤判定していた。
 *
 * issue #124: 戻り値を 3 値化し、「四ではない」と「防御不可」を区別した。
 * `createsFour`（`isFourInDirection`）も同じ基準なので両者は常に整合する。
 *
 * @param board 盤面（四が作られた状態）
 * @param lastMove 最後に置かれた手
 * @param color 四を作った手番
 */
export function getFourDefensePosition(
  board: BoardState,
  lastMove: Position,
  color: "black" | "white",
): FourDefense {
  const { row, col } = lastMove;
  let firstDefense: Position | null = null;

  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    // 方向ごとの分類は `classifyFourInDirection`（四判定・受け点の SSoT・issue #134）。
    const fourClass = classifyFourInDirection(board, row, col, i, color);
    switch (fourClass.kind) {
      case "unstoppable":
        // 両方は塞げない = 活四（防御不可能）
        return FOUR_DEFENSE_UNSTOPPABLE;
      case "block":
        firstDefense ??= fourClass.position;
        break;
      case "not_four":
        // この方向は四ではない（黒の長連にしかならない四）
        break;
      default: {
        // 網羅チェック（FourClass に値が増えたらここで型エラーになる）
        const exhaustive: never = fourClass;
        return exhaustive;
      }
    }
  }

  return firstDefense
    ? { kind: "block", position: firstDefense }
    : FOUR_DEFENSE_NOT_FOUR;
}

// issue #121 / #43: `findDefenseForConsecutiveFour` / `findDefenseForJumpFour` は削除した。
// 受け点は `getFourDefensePosition`（= `collectLineFivePoints` の五点列挙）に一本化済みで、
// この 2 つは「連続四なら端の空き / 跳び四なら最も近いギャップ」という旧基準そのものだった。
// 参照は `search/index.ts` の再 export のみ（live な呼び出し元ゼロ）。

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

    // 四（連続四・跳び四とも isFourInDirection に一本化・issue #124）。
    // ここを getFourDefensePosition と同一基準にしておかないと、
    // 「four と分類されたのに受け点が 0 個」という不整合が起きる。
    if (isFourInDirection(board, row, col, i, opponentColor, count)) {
      return "four";
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
