/**
 * 実際に打った手が追い詰め開始手かチェックし、スコアとシーケンスを返す
 *
 * review.worker.ts から SRP 切り出し。
 */

import type { BoardState, Position } from "@/types/game";

import type { MoveScoreEntry } from "../search/results";

import { countStones } from "../core/boardUtils";
import { PATTERN_SCORES } from "../evaluation";
import { findVCFSequenceFromFirstMove } from "../search/vcf";
import {
  findVCTSequenceFromFirstMove,
  isVCTFirstMove,
  VCT_STONE_THRESHOLD,
} from "../search/vct";
import { REVIEW_VCF_OPTIONS } from "./forcedLossCheck";
import { REVIEW_VCT_OPTIONS_WITH_BRANCHES } from "./reviewConstants";

export interface PlayedForcedWinResult {
  playedScore: number;
  playedForcedWinSequence: Position[] | undefined;
}

/**
 * 実際に打った手が追い詰め開始手かチェックし、スコアとシーケンスを返す
 */
export function evaluatePlayedForcedWin(
  board: BoardState,
  color: "black" | "white",
  playedRow: number,
  playedCol: number,
  bestMove: Position,
  bestScore: number,
  result: { candidates?: MoveScoreEntry[]; score: number },
  skipVctThresholdCheck?: boolean,
  doubleMiseMoves?: Position[],
): PlayedForcedWinResult {
  if (
    playedRow < 0 ||
    (playedRow === bestMove.row && playedCol === bestMove.col)
  ) {
    return { playedScore: bestScore, playedForcedWinSequence: undefined };
  }

  const playedPos = { row: playedRow, col: playedCol };

  // 両ミセ手チェック（VCFより前に）
  if (
    doubleMiseMoves?.some((m) => m.row === playedRow && m.col === playedCol)
  ) {
    return {
      playedScore: PATTERN_SCORES.FIVE,
      playedForcedWinSequence: undefined,
    };
  }

  // VCF シーケンス取得を試行
  const vcfFromPlayed = findVCFSequenceFromFirstMove(
    board,
    playedPos,
    color,
    REVIEW_VCF_OPTIONS,
  );
  if (vcfFromPlayed) {
    return {
      playedScore: PATTERN_SCORES.FIVE,
      playedForcedWinSequence: vcfFromPlayed.sequence,
    };
  }

  // VCT シーケンス取得を試行
  if (skipVctThresholdCheck || countStones(board) >= VCT_STONE_THRESHOLD) {
    const vctFromPlayed = findVCTSequenceFromFirstMove(
      board,
      playedPos,
      color,
      REVIEW_VCT_OPTIONS_WITH_BRANCHES,
    );
    if (vctFromPlayed) {
      return {
        playedScore: PATTERN_SCORES.FIVE,
        playedForcedWinSequence: vctFromPlayed.sequence,
      };
    }
    // VCT開始手だがシーケンス取得失敗（カウンター脅威の実装差）
    if (
      isVCTFirstMove(board, playedPos, color, REVIEW_VCT_OPTIONS_WITH_BRANCHES)
    ) {
      return {
        playedScore: PATTERN_SCORES.FIVE,
        playedForcedWinSequence: undefined,
      };
    }
  }

  // minimax候補から探す
  const minimaxEntry = result.candidates?.find(
    (c) => c.move.row === playedRow && c.move.col === playedCol,
  );
  return {
    playedScore: minimaxEntry?.score ?? result.score - 2000,
    playedForcedWinSequence: undefined,
  };
}
