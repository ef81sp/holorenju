/**
 * 実際に打った手が追い詰め開始手かチェックし、スコアとシーケンスを返す
 *
 * review.worker.ts から SRP 切り出し。
 */

import type { BoardState, Position } from "@/types/game";

import type { MoveScoreEntry } from "../search/types";
import type { WasmSearchEngine } from "../wasm/searchEngine";

import { PATTERN_SCORES } from "../evaluation";
import { REVIEW_VCF_OPTIONS } from "./forcedLossCheck";
import { REVIEW_VCT_OPTIONS_WITH_BRANCHES } from "./reviewConstants";
import {
  wasmFindVCFSequenceFromFirstMove,
  wasmFindVCTSequenceFromFirstMove,
  wasmIsVCTFirstMove,
} from "./wasmAdapters";

export interface PlayedForcedWinResult {
  playedScore: number;
  playedForcedWinSequence: Position[] | undefined;
}

/** 実手スコア推定の追加探索パラメータ（attachPVFromWasm のプローブと同一値） */
const PLAYED_PROBE_DEPTH = 3;
const PLAYED_PROBE_TIME_MS = 2000;
const PLAYED_PROBE_MAX_NODES = 200000;

/**
 * 実手が minimax 候補(top5)外のとき、実手局面を浅く追加探索して実スコアを推定する。
 *
 * 実手を置いた後の局面（相手手番）を探索し、相手視点のベストスコアを符号反転して
 * 実手側(color)視点のスコアを得る（negamax 規則）。従来の `bestScore - 2000` 固定
 * フォールバックを置き換え、候補外の手を一律 blunder と誤判定する問題を解消する。
 *
 * NoTTClear で探索するため、後続の attachPVFromWasm が同一局面の PV を TT から再利用でき、
 * 追加探索の重複を抑える。
 *
 * @returns 実手側視点のスコア。実手座標が盤外/既石なら null（呼び出し側でフォールバック）。
 */
export function probePlayedMoveScore(
  board: BoardState,
  playedRow: number,
  playedCol: number,
  color: "black" | "white",
  engine: WasmSearchEngine,
): number | null {
  const row = board[playedRow];
  if (!row || row[playedCol] !== null) {
    return null;
  }
  const opponentColor = color === "black" ? "white" : "black";
  row[playedCol] = color;
  try {
    const probe = engine.findBestMoveWithParamsNoTTClear(
      board,
      opponentColor,
      PLAYED_PROBE_DEPTH,
      PLAYED_PROBE_TIME_MS,
      PLAYED_PROBE_MAX_NODES,
    );
    return -probe.score;
  } finally {
    row[playedCol] = null;
  }
}

/**
 * 実手スコアの決定（review-multipv-2026-09-06.md §2.5 経路 1・2 の共通規則）
 *
 * - 実手が候補内で真値（scoreExact）: その値。
 * - 実手が候補内で境界値（root fail-low の上限）: 上限をそのまま採用すると実手が
 *   実際より良く見え悪手判定が甘くなる。ただし上限は深さ d の情報なので捨てず、
 *   probe（深さ 3・全窓）との min を採る。probe 不能なら上限のみ。
 * - 実手が候補外: probe。不能なら fallback。
 */
export function resolvePlayedScore(
  candidates: MoveScoreEntry[] | undefined,
  playedRow: number,
  playedCol: number,
  probe: () => number | null,
  fallback: number,
): number {
  const entry = candidates?.find(
    (c) => c.move.row === playedRow && c.move.col === playedCol,
  );
  if (entry?.scoreExact) {
    return entry.score;
  }
  const probed = probe();
  if (entry) {
    return probed === null ? entry.score : Math.min(entry.score, probed);
  }
  return probed ?? fallback;
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
  wasmSearchEngine: WasmSearchEngine,
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
  const vcfFromPlayed = wasmFindVCFSequenceFromFirstMove(
    wasmSearchEngine,
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
  {
    const vctFromPlayed = wasmFindVCTSequenceFromFirstMove(
      wasmSearchEngine,
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
    const isFirstMove = wasmIsVCTFirstMove(
      wasmSearchEngine,
      board,
      playedPos,
      color,
      REVIEW_VCT_OPTIONS_WITH_BRANCHES,
    );
    if (isFirstMove) {
      return {
        playedScore: PATTERN_SCORES.FIVE,
        playedForcedWinSequence: undefined,
      };
    }
  }

  // minimax候補から探す（真値のみ採用。境界値は probe との min）
  // 候補外なら実手局面を追加探索して実スコアを推定（-2000固定の誤blunderを回避）
  const playedScore = resolvePlayedScore(
    result.candidates,
    playedRow,
    playedCol,
    () =>
      probePlayedMoveScore(
        board,
        playedRow,
        playedCol,
        color,
        wasmSearchEngine,
      ),
    result.score - 2000,
  );
  return {
    playedScore,
    playedForcedWinSequence: undefined,
  };
}
