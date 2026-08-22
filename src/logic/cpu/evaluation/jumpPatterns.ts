/**
 * 跳びパターン分析
 *
 * 跳び三・跳び四のパターン検出と評価
 */

import type { BoardState } from "@/types/game";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
// 四判定の SSoT（issue #124 / #134）。Zig 側 `threats.classifyFourInDirection` /
// `isFourInDirectionWithPattern` と対応する。
import {
  classifyFourInDirection,
  isFourInDirection,
} from "../search/threatMoves";
// #43 PR-3: 図形/禁手の葉プリミティブを Zig アダプタへ委譲（patterns.ts/forbiddenMoves.ts 依存を断つ）。
// 本ファイルは vctHelpers/winningPatterns（review judgment）から live のため存続。
import { isForbiddenForBlack } from "../wasm/forbiddenAdapter";
import {
  checkJumpThree,
  checkStraightFour,
  getConsecutiveThreeStraightFourPoints,
  getJumpThreeStraightFourPoints,
} from "../wasm/patternsAdapter";
import { analyzeDirection } from "./directionAnalysis";
import {
  type DirectionPattern,
  type JumpPatternResult,
  PATTERN_SCORES,
} from "./patternScores";

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
  color: "black" | "white" = "black",
): boolean {
  const straightFourPoints = getConsecutiveThreeStraightFourPoints(
    board,
    row,
    col,
    dirIndex,
    color,
  );

  if (straightFourPoints.length === 0) {
    return false;
  }

  for (const pos of straightFourPoints) {
    // 白には禁手がないのでチェック不要
    if (color === "black" && isForbiddenForBlack(board, pos.row, pos.col)) {
      continue;
    }
    if (checkStraightFour(board, pos.row, pos.col, dirIndex, color)) {
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
  color: "black" | "white" = "black",
): boolean {
  const straightFourPoints = getJumpThreeStraightFourPoints(
    board,
    row,
    col,
    dirIndex,
    color,
  );

  if (straightFourPoints.length === 0) {
    return false;
  }

  for (const pos of straightFourPoints) {
    // 白には禁手がないのでチェック不要
    if (color === "black" && isForbiddenForBlack(board, pos.row, pos.col)) {
      continue;
    }
    if (checkStraightFour(board, pos.row, pos.col, dirIndex, color)) {
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
  precomputed?: DirectionPattern[],
): JumpPatternResult {
  const result: JumpPatternResult = {
    hasFour: false,
    jumpFourCount: 0,
    hasOpenFour: false,
    hasJumpThree: false,
    hasValidOpenThree: false,
  };

  // まず各方向の四を先にチェックして記録
  // 同じ方向に跳び四がある場合、連続三を活三としてカウントしないため
  const jumpFourDirections = new Set<number>();
  const isFourDirections: boolean[] = new Array<boolean>(
    DIRECTION_INDICES.length,
  ).fill(false);

  // パターンキャッシュ（precomputed がない場合のみ計算）
  const patterns: DirectionPattern[] =
    precomputed ?? computePatterns(board, row, col, color);

  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const pattern = patterns[i];
    if (!pattern) {
      continue;
    }

    // 四の判定（連続四・跳び四とも五点列挙に一本化・issue #134）
    //
    // issue #121: `checkJumpFour` は中心 ±4 マスの窓しか見ないため、窓の外の自石で
    // ギャップ埋めが長連（6 連以上）になる黒の形も跳び四として報告する。四かどうかの
    // 最終判断は五点の列挙に委ねる。偽の跳び四を四に数えると「四三」でない手を
    // ミセ手として生成してしまう。
    // 足切り（`checkJumpFour`）も `isFourInDirection` の内部で行うので、
    // ここで先に呼ぶと wasm 境界の syncCells が 2 回走ることになる。一本化する。
    //
    // ここでは「四かどうか」の boolean しか要らないので、分類 3 値
    // （`classifyFourInDirection`）ではなく**早期打ち切り版**を使う（活四かどうかが
    // 必要な方向だけ下で分類する）。`analyzeJumpPatterns` は `createsFourThree` 経由で
    // ムーブオーダリングのホットパスに乗る。
    isFourDirections[i] = isFourInDirection(
      board,
      row,
      col,
      i,
      color,
      pattern.count,
    );

    // 「跳び四の方向」= 四だが連続四ではない方向。同方向の三を四三に数えないための
    // ガードに使う（連続四の方向は count === 4 なので三のブランチに入らない）。
    if (pattern.count !== 4 && isFourDirections[i]) {
      jumpFourDirections.add(i);
    }
  }

  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) {
      continue;
    }

    const pattern = patterns[i];
    if (!pattern) {
      continue;
    }

    // 四（連続四・跳び四とも 1st pass の五点列挙に一本化・issue #134）
    //
    // 旧実装の連続四側は端ベース（`analyzeDirection` の黒長連補正済みの端）だったが、
    // `count === 4` に限れば五点列挙と等価:
    //   - 偽陽性なし: 端が空きかつ長連補正を通れば、その端を埋めると必ずちょうど 5
    //   - 偽陰性なし: 連続 4 連の五点は両端のいずれかにしか存在しえない
    // 活四（両端空き）も「五点 2 個以上 = unstoppable」と一致する。
    if (isFourDirections[i]) {
      result.hasFour = true;
      // 活四かどうかが要るのは**連続四の方向だけ**なので、ここでだけ 3 値の分類を引く。
      // `count !== 4`（跳び四）の方向で `unstoppable` を立てないのは旧実装と揃えるため
      //（旧実装は「跳び四は両端開の形がないので常に止め四扱い」として hasOpenFour を
      // 立てなかった。挙動不変のためこのガードを残す）。
      if (
        pattern.count === 4 &&
        classifyFourInDirection(board, row, col, i, color, pattern.count)
          .kind === "unstoppable"
      ) {
        result.hasOpenFour = true;
      }
    }

    // 連続三をチェック（活三）
    // ただし、同じ方向に跳び四がある場合は活三としてカウントしない
    // （その方向は「四を作る」方向であり「活三を作る」方向ではない）
    if (pattern.count === 3 && !jumpFourDirections.has(i)) {
      if (pattern.end1 === "empty" && pattern.end2 === "empty") {
        if (isValidConsecutiveThree(board, row, col, dirIndex, color)) {
          result.hasValidOpenThree = true;
        }
      }
    }

    // 跳び四をチェック（連続四がない場合のみ）
    if (jumpFourDirections.has(i)) {
      result.jumpFourCount++;
      // 跳び四は両端開の形がないので、常に止め四扱い
    }

    // 跳び三をチェック（連続三がなく、跳び四もない場合のみ）
    // 跳び四と同方向の跳び三は同一スジの四と三であり、四三を構成しない
    if (
      pattern.count !== 3 &&
      !jumpFourDirections.has(i) &&
      checkJumpThree(board, row, col, dirIndex, color)
    ) {
      result.hasJumpThree = true;
      if (isValidJumpThree(board, row, col, dirIndex, color)) {
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

/** precomputed がない場合のフォールバック */
function computePatterns(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): DirectionPattern[] {
  const patterns: DirectionPattern[] = [];
  for (const direction of DIRECTIONS) {
    if (!direction) {
      patterns.push({ count: 1, end1: "edge", end2: "edge" });
      continue;
    }
    const [dr, dc] = direction;
    patterns.push(analyzeDirection(board, row, col, dr, dc, color));
  }
  return patterns;
}
