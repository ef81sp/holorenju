/**
 * 脅威手の判定（共通ロジック）
 *
 * VCF/VCT探索で使用する四・活三の判定関数を共通化（DRY）
 */

import type { BoardState } from "@/types/game";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import {
  checkEnds,
  collectLineFivePoints,
  countLine,
} from "../core/lineAnalysis";
// 夏止め済み判定（受け点の基準と活三判定を一致させる SSoT）
import { getOpenThreeDefensePositions } from "../evaluation/threatDetection";
// #43 PR-3: 跳び四/三の図形判定を Zig アダプタへ委譲（patterns.ts 依存を断つ）。
import { checkJumpFour, checkJumpThree } from "../wasm/patternsAdapter";

/**
 * 指定位置に石を置くと四ができるかチェック
 *
 * @param board 盤面（石を置いた後の状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 四ができる場合true
 */
export function createsFour(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    if (isFourInDirection(board, row, col, i, color)) {
      return true;
    }
  }

  return false;
}

/**
 * その方向で「四」が成立しているかを判定する（四判定の SSoT・issue #124）
 *
 * **四の定義**: あと 1 手で五にできる点がその方向に存在すること。
 * これは `collectLineFivePoints` が列挙する五点が 1 つ以上あることと同値であり、
 * 受け点を返す `getFourDefensePosition` と完全に同じ基準になる。
 *
 * 以前は「連続四なら端の空きを見る（黒は `checkEndsForFour` 補正）／跳び四なら
 * 最も近いギャップだけを `isJumpFourOverline` で見る」という別基準で判定しており、
 * 同一ライン上に長連ギャップと「埋めても五にならないギャップ」が併存すると
 * 四でない手を四と判定していた（受け点 0 個 → 防御不可 → 偽 VCF・issue #124）。
 *
 * `countLine` / `checkJumpFour` による四パターン判定は候補の足切りにのみ使う。
 * 最終判断は必ず五点の列挙で行う。Zig 側 `threats.isFourInDirection` と対応する。
 *
 * @param i DIRECTIONS / DIRECTION_INDICES のインデックス（0..3）
 */
export function isFourInDirection(
  board: BoardState,
  row: number,
  col: number,
  i: number,
  color: "black" | "white",
): boolean {
  const dirIndex = DIRECTION_INDICES[i];
  const direction = DIRECTIONS[i];
  if (dirIndex === undefined || !direction) {
    return false;
  }
  const [dr, dc] = direction;

  const count = countLine(board, row, col, dr, dc, color);
  if (count !== 4 && !checkJumpFour(board, row, col, dirIndex, color)) {
    return false;
  }

  return collectLineFivePoints(board, row, col, dr, dc, color).length > 0;
}

/**
 * 指定位置に石を置くと活三ができるかチェック
 *
 * @param board 盤面（石を置いた後の状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 活三ができる場合true
 */
export function createsOpenThree(
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
    // 夏止め済み（両外側ブロックで活四にできない三）は脅威でないため除外。
    // 受け点の基準（getOpenThreeDefensePositions: 空リスト=夏止め済み）と揃える。
    const count = countLine(board, row, col, dr, dc, color);
    if (count === 3) {
      const { end1Open, end2Open } = checkEnds(board, row, col, dr, dc, color);
      if (
        end1Open &&
        end2Open &&
        getOpenThreeDefensePositions(board, row, col, dr, dc, color).length > 0
      ) {
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
 * 四と活三を1パスの方向走査で同時に判定
 *
 * createsFour と createsOpenThree の両方が必要な呼び出し元で使用し、
 * 2回の方向走査を1回に削減する。
 *
 * @param board 盤面（石を置いた後の状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 四と活三の判定結果
 */
export interface ThreatClassification {
  createsFour: boolean;
  createsOpenThree: boolean;
}

export function classifyThreat(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): ThreatClassification {
  let hasFour = false;
  let hasOpenThree = false;

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

    const count = countLine(board, row, col, dr, dc, color);

    // 四（連続四・跳び四とも isFourInDirection に一本化・issue #124）
    if (!hasFour && isFourInDirection(board, row, col, i, color)) {
      hasFour = true;
    }

    // 連続三をチェック
    // 夏止め済み（両外側ブロックで活四にできない三）は脅威でないため除外（createsOpenThree と同基準）
    if (!hasOpenThree && count === 3) {
      const { end1Open, end2Open } = checkEnds(board, row, col, dr, dc, color);
      if (
        end1Open &&
        end2Open &&
        getOpenThreeDefensePositions(board, row, col, dr, dc, color).length > 0
      ) {
        hasOpenThree = true;
      }
    }

    // 跳び三をチェック
    if (!hasOpenThree && count !== 3) {
      if (checkJumpThree(board, row, col, dirIndex, color)) {
        hasOpenThree = true;
      }
    }

    // 両方見つかったら早期終了
    if (hasFour && hasOpenThree) {
      break;
    }
  }

  return { createsFour: hasFour, createsOpenThree: hasOpenThree };
}
