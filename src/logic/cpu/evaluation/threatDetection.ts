/**
 * 脅威検出
 *
 * 相手の活四・止め四・活三などの脅威を検出
 */

import type { BoardState, Position } from "@/types/game";

import { incrementThreatDetectionCalls } from "@/logic/cpu/profiling/counters";
import { isValidPosition } from "@/logic/renjuRules";

import type { LineTable } from "../lineTable/lineTable";

import { includesPosition } from "../core/boardUtils";
import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { getDirectionPattern } from "../lineTable/adapter";
import { isNearExistingStone } from "../moveGenerator";
// 四判定の SSoT（issue #124 / #134）。Zig 側 `threats.classifyFourInDirection` と対応する。
import {
  classifyFourInDirection,
  isFourInDirection,
} from "../search/threatMoves";
// #43 PR-3: 跳び四/三の図形判定を Zig アダプタへ委譲（patterns.ts 依存を断つ）。
// getOpenThreeDefensePositions が vctHelpers（review judgment）から live のため存続。
import { checkJumpThree } from "../wasm/patternsAdapter";
import { analyzeDirection } from "./directionAnalysis";
import { isValidConsecutiveThree, isValidJumpThree } from "./jumpPatterns";
import { type ThreatInfo, PATTERN_SCORES } from "./patternScores";
// #43 PR-6: tactics 再exportハブ廃止に伴い実体(winningPatterns)から直 import。
import { createsDoubleThree, createsFourThree } from "./winningPatterns";

/**
 * 配列に重複しない位置を追加するヘルパー関数
 */
function addUniquePosition(positions: Position[], pos: Position): void {
  if (!includesPosition(positions, pos.row, pos.col)) {
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
  return openThrees.some((pos) => includesPosition(mises, pos.row, pos.col));
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
  lineTable?: LineTable,
): number {
  let threatCount = 0;

  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) {
      continue;
    }

    const pattern = getDirectionPattern(board, row, col, i, color, lineTable);

    // 四（連続四・跳び四とも `isFourInDirection` に一本化・issue #121 / #124）
    //
    // LUT は盤面を見ないため、黒は「ギャップを埋めると長連（6 連以上）になるだけで
    // 五にはできない」形も跳び四として報告する。四かどうかの最終判断はライン上の
    // 五点列挙（`collectLineFivePoints`）に委ねる。
    //
    // 四でなければ下の活三/跳び三ブランチに落ちる（＝偽の四で三を握り潰さない）。
    if (isFourInDirection(board, row, col, i, color, pattern.count)) {
      threatCount++;
      continue;
    }

    // 活三（四チェックで continue 済みのため、本物の跳び四の一部は到達しない）
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
    doubleThrees: [],
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

        // 四（連続四・跳び四とも五点の列挙に一本化・issue #121 / #124）
        //
        // 「四の受け＝そのラインで埋めると本当に五になる点」という一つの基準
        // （`collectLineFivePoints`。Zig `threats.detectThreatsCore` と同じ SSoT）で判定する。
        //
        // - 五点 2 個以上: どちらを塞いでも五にされる ＝ 活四
        // - 五点 1 個: 止め四。その 1 点が受け
        // - 五点 0 個: この方向は四ではない（黒の長連にしかならない）
        //   → 四扱いをやめ、下の活三ブランチで受けを列挙する
        //
        // 旧実装は `pattern.count === 4` / `checkJumpFour` をそのまま四とみなし、
        // 受けを `getLineEnds` / `findJumpGapPosition` から取っていた。跳び四判定は
        // ±4 マスの窓しか見ないため、窓の外の自石でギャップ埋めが長連になる黒の形を
        // 四と誤判定し、しかも `isJumpFour` が活三の受け列挙まで抑止していた（issue #121）。
        //
        // issue #134: 分岐そのものは `classifyFourInDirection`（SSoT）に一本化した。
        const fourClass = classifyFourInDirection(
          board,
          row,
          col,
          dirIdx,
          opponentColor,
          pattern.count,
        );
        const isFour = fourClass.kind !== "not_four";
        if (fourClass.kind === "unstoppable") {
          addUniquePositions(result.openFours, fourClass.fivePoints);
        } else if (fourClass.kind === "block") {
          addUniquePositions(result.fours, [fourClass.position]);
        }

        // 活三をチェック（両端が空いている3連）
        // 四が成立している方向は四の受けが優先
        //
        // 黒はウソの三（達四にできない三）を除外する。issue #121 で偽の跳び四が
        // 四から外れた結果、その裏に隠れていた「四でも三でもない」形が活三として
        // 流入するようになったため。openThrees は position_eval の必須防御に直結する。
        // `countThreatDirections` / `vctHelpers.isConsecutiveOpenThree` と同じガード。
        if (
          !isFour &&
          pattern.count === 3 &&
          pattern.end1 === "empty" &&
          pattern.end2 === "empty" &&
          (opponentColor !== "black" ||
            isValidConsecutiveThree(
              board,
              row,
              col,
              renjuDirIndex,
              opponentColor,
            ))
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
        // 黒はウソの三を除外（上の活三ブランチと同じ理由）
        if (
          pattern.count < 3 &&
          (opponentColor !== "black" ||
            isValidJumpThree(board, row, col, renjuDirIndex, opponentColor))
        ) {
          addUniquePositions(
            result.openThrees,
            detectJumpThreePattern(board, row, col, dr, dc, opponentColor),
          );
        }
      }
    }
  }

  // 相手のミセ手（次に四三が作れる位置）+ 三三脅威を1つのループで検出
  // 四三・三三を作るには同色石が近くに必要なので、石の近傍のみ走査
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r]?.[c] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, r, c)) {
        continue;
      }

      // ミセ手チェック
      if (createsFourThree(board, r, c, opponentColor)) {
        result.mises.push({ row: r, col: c });
      }

      // 三三脅威チェック（白のみ: 黒は三三が禁手）
      if (
        opponentColor === "white" &&
        createsDoubleThree(board, r, c, opponentColor)
      ) {
        result.doubleThrees.push({ row: r, col: c });
      }
    }
  }

  return result;
}
