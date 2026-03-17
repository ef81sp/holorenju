/**
 * 脅威検出（LineTable プレフィルタ版）
 *
 * precomputeLineFeatures() で事前計算された packed patterns を使い、
 * analyzeDirection() の呼び出しを省略して高速化する。
 * 結果は detectOpponentThreats() と等価。
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import type { BoardState } from "@/types/game";

import { incrementThreatDetectionCalls } from "@/logic/cpu/profiling/counters";
import { checkJumpFour } from "@/logic/renjuRules";

import type { LineTable } from "../lineTable/lineTable";
import type { ThreatInfo } from "./patternScores";

import { includesPosition } from "../core/boardUtils";
import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import {
  precomputedBlackPatterns,
  precomputedWhitePatterns,
  precomputeLineFeatures,
} from "../lineTable/lineScan";
import { isNearExistingStone } from "../moveGenerator";
import { findJumpGapPosition } from "../patterns/threatAnalysis";
import { createsDoubleThree, createsFourThree } from "./tactics";
import {
  addUniquePositions,
  detectJumpThreePattern,
  getOpenFourDefensePositions,
  getOpenThreeDefensePositions,
} from "./threatDetection";

const END_CODE_EMPTY = 2;

/**
 * 相手の脅威を検出（LineTable プレフィルタ版）
 *
 * detectOpponentThreats と等価な結果を返す。
 * Loop 1 で analyzeDirection の代わりに precomputed patterns を参照し、
 * 脅威候補セルのみで防御位置特定ロジックを実行する。
 *
 * @param board 盤面
 * @param opponentColor 相手の色
 * @param lineTable LineTable（必須）
 * @returns 脅威情報（detectOpponentThreats と等価）
 */
export function detectOpponentThreatsFast(
  board: BoardState,
  opponentColor: "black" | "white",
  lineTable: LineTable,
): ThreatInfo {
  incrementThreatDetectionCalls();

  // precomputed patterns を更新
  precomputeLineFeatures(lineTable.blacks, lineTable.whites);

  const patterns =
    opponentColor === "black"
      ? precomputedBlackPatterns
      : precomputedWhitePatterns;

  const result: ThreatInfo = {
    openFours: [],
    fours: [],
    openThrees: [],
    mises: [],
    doubleThrees: [],
  };

  // ─── Loop 1: 石のパターン分析（precomputed patterns で高速化） ───
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      if (board[row]?.[col] !== opponentColor) {
        continue;
      }

      const cellIndex = row * 15 + col;

      for (let dirIdx = 0; dirIdx < DIRECTIONS.length; dirIdx++) {
        const direction = DIRECTIONS[dirIdx];
        if (!direction) {
          continue;
        }
        const [dr, dc] = direction;
        const renjuDirIndex = DIRECTION_INDICES[dirIdx] ?? -1;

        const packed = patterns[cellIndex * 4 + dirIdx] ?? 0;
        if (packed === 0) {
          continue;
        }

        const count = packed >> 4;
        const end1Code = (packed >> 2) & 3;
        const end2Code = packed & 3;

        // 活四: count==4, 両端 empty
        if (
          count === 4 &&
          end1Code === END_CODE_EMPTY &&
          end2Code === END_CODE_EMPTY
        ) {
          addUniquePositions(
            result.openFours,
            getOpenFourDefensePositions(board, row, col, dr, dc, opponentColor),
          );
        }

        // 止め四: count==4, 片端のみ empty
        if (
          count === 4 &&
          ((end1Code === END_CODE_EMPTY && end2Code !== END_CODE_EMPTY) ||
            (end1Code !== END_CODE_EMPTY && end2Code === END_CODE_EMPTY))
        ) {
          addUniquePositions(
            result.fours,
            getOpenFourDefensePositions(board, row, col, dr, dc, opponentColor),
          );
        }

        // 跳び四: count!=4 で checkJumpFour が成立
        let isJumpFour = false;
        if (
          count !== 4 &&
          renjuDirIndex >= 0 &&
          checkJumpFour(board, row, col, renjuDirIndex, opponentColor)
        ) {
          isJumpFour = true;
          const gapPos = findJumpGapPosition(
            board,
            row,
            col,
            dr,
            dc,
            opponentColor,
          );
          if (
            gapPos &&
            !includesPosition(result.fours, gapPos.row, gapPos.col)
          ) {
            result.fours.push(gapPos);
          }
        }

        // 活三: count==3, 両端 empty, 跳び四ではない
        if (
          !isJumpFour &&
          count === 3 &&
          end1Code === END_CODE_EMPTY &&
          end2Code === END_CODE_EMPTY
        ) {
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

        // 跳び三: count<3
        if (count < 3) {
          addUniquePositions(
            result.openThrees,
            detectJumpThreePattern(board, row, col, dr, dc, opponentColor),
          );
        }
      }
    }
  }

  // ─── Loop 2: ミセ手・三三検出（既存ロジックそのまま） ───
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
