/**
 * 振り返り評価用 Web Worker
 *
 * 1手を受け取り、その局面でhard準拠の探索を実行して評価結果を返す
 *
 * Viteの?workerサフィックスでインポートして使用:
 * import ReviewWorker from './review.worker?worker'
 */

import type { ReviewEvalRequest, ReviewWorkerResult } from "@/types/review";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { DIFFICULTY_PARAMS } from "@/types/cpu";

import { findBestMoveIterativeWithTT } from "./search/minimax";

/** 振り返り用パラメータ（hard準拠、速度重視） */
const REVIEW_TIME_LIMIT = 3000;
const REVIEW_MAX_NODES = 300000;

self.onmessage = (event: MessageEvent<ReviewEvalRequest>) => {
  const { moveHistory, moveIndex, playerFirst: _playerFirst } = event.data;

  try {
    const moves = moveHistory.trim().split(/\s+/);

    // moveIndex時点の盤面を再構築（moveIndex手目の前の局面）
    const { board, nextColor } = createBoardFromRecord(
      moves.slice(0, moveIndex).join(" "),
    );

    const color = nextColor as "black" | "white";
    const hardParams = DIFFICULTY_PARAMS.hard;

    // 最善手の探索
    const result = findBestMoveIterativeWithTT(
      board,
      color,
      hardParams.depth,
      REVIEW_TIME_LIMIT,
      0, // randomFactor: 0（決定論的）
      hardParams.evaluationOptions,
      REVIEW_MAX_NODES,
    );

    // 実際の手のスコアを取得（候補手リストから検索）
    const playedMoveStr = moves[moveIndex];
    let playedScore = result.score; // デフォルトは最善手スコア

    if (playedMoveStr && result.candidates) {
      // 実際の手をパース
      const playedCol = playedMoveStr.charCodeAt(0) - "A".charCodeAt(0);
      const playedRowNum = parseInt(playedMoveStr.slice(1), 10);
      const playedRow = 15 - playedRowNum;

      // 候補手リストから一致する手のスコアを取得
      const played = result.candidates.find(
        (c) => c.move.row === playedRow && c.move.col === playedCol,
      );
      if (played) {
        playedScore = played.score;
      } else {
        // 候補手にない場合: 最善手スコアから大きな差をつける
        playedScore = result.score - 2000;
      }
    }

    // 上位候補手（5手まで）
    const candidates = (result.candidates ?? []).slice(0, 5).map((c) => ({
      position: c.move,
      score: c.score,
    }));

    const response: ReviewWorkerResult = {
      moveIndex,
      bestMove: result.position,
      bestScore: result.score,
      playedScore,
      candidates,
    };

    self.postMessage(response);
  } catch (error) {
    console.error("Review Worker error:", error);
    // エラー時はデフォルト結果を返す
    const response: ReviewWorkerResult = {
      moveIndex,
      bestMove: { row: 7, col: 7 },
      bestScore: 0,
      playedScore: 0,
      candidates: [],
    };
    self.postMessage(response);
  }
};

export type { ReviewEvalRequest, ReviewWorkerResult };
