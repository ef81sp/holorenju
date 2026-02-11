/**
 * Renju CPU Web Worker
 *
 * CPUをメインスレッドから分離してUIブロッキングを回避
 *
 * Viteの?workerサフィックスでインポートして使用:
 * import CpuWorker from './cpu.worker?worker'
 */

import {
  DIFFICULTY_PARAMS,
  type CpuRequest,
  type CpuResponse,
  type ScoreBreakdown,
} from "@/types/cpu";

import { countStones } from "./core/boardUtils";
import {
  evaluateBoardWithBreakdown,
  evaluatePositionWithBreakdown,
} from "./evaluation";
import { getOpeningMove, isOpeningPhase } from "./opening";
import { findBestMoveIterativeWithTT } from "./search/minimax";

/**
 * Worker内でのメッセージハンドラ
 *
 * 開局フェーズ（1〜3手目）では珠型パターンを使用し、
 * 4手目以降はIterative Deepeningで探索する
 */
self.onmessage = (event: MessageEvent<CpuRequest>) => {
  const request = event.data;
  const startTime = performance.now();

  try {
    const moveCount = countStones(request.board);
    const currentTurn = request.currentTurn as "black" | "white";

    // 開局フェーズかチェック
    if (isOpeningPhase(moveCount)) {
      const openingMove = getOpeningMove(request.board, currentTurn);
      if (openingMove) {
        // 探索と同程度の遅延を設ける（難易度に応じた時間の30-60%）
        const params = DIFFICULTY_PARAMS[request.difficulty];
        const minDelay = params.timeLimit * 0.3;
        const maxDelay = params.timeLimit * 0.6;
        const delay = minDelay + Math.random() * (maxDelay - minDelay);

        setTimeout(() => {
          const endTime = performance.now();
          const thinkingTime = Math.round(endTime - startTime);

          const response: CpuResponse = {
            position: openingMove,
            score: 0, // 開局の手は評価スコアなし
            thinkingTime,
            depth: 0, // 探索なし
          };

          self.postMessage(response);
        }, delay);
        return;
      }
    }

    // 4手目以降、または開局パターン外の場合は通常のCPU探索
    const params = DIFFICULTY_PARAMS[request.difficulty];

    // Iterative Deepeningで探索（TT/Move Ordering統合版）
    const result = findBestMoveIterativeWithTT(
      request.board,
      currentTurn,
      params.depth,
      params.timeLimit,
      params.randomFactor,
      params.evaluationOptions,
      params.maxNodes,
      undefined, // absoluteTimeLimit: デフォルト値を使用
      params.scoreThreshold,
    );

    const endTime = performance.now();
    const thinkingTime = Math.round(endTime - startTime);

    // 候補手を上位5手に制限（通信オーバーヘッド削減）
    // 各候補手の内訳を計算
    const candidates = result.candidates?.slice(0, 5).map((entry, index) => {
      // 即時評価の内訳を計算
      const { score: breakdownScore, breakdown } =
        evaluatePositionWithBreakdown(
          request.board,
          entry.move.row,
          entry.move.col,
          currentTurn,
          params.evaluationOptions,
        );

      // 探索末端の評価内訳を計算（PVがある場合）
      const leafEvaluation =
        entry.pvLeafBoard && entry.pvLeafColor
          ? evaluateBoardWithBreakdown(entry.pvLeafBoard, currentTurn)
          : undefined;

      return {
        position: entry.move,
        score: Math.round(breakdownScore), // 即時評価（内訳の合計）
        searchScore: entry.score, // 探索スコア（順位の根拠）
        rank: index + 1,
        breakdown: breakdown as ScoreBreakdown,
        principalVariation: entry.pv, // 予想手順
        leafEvaluation, // 探索末端の評価内訳
      };
    });

    // 深度履歴を変換
    const depthHistory = result.depthHistory?.map((entry) => ({
      depth: entry.depth,
      position: entry.position,
      score: entry.score,
    }));

    const response: CpuResponse = {
      position: result.position,
      score: result.score,
      thinkingTime,
      depth: result.completedDepth,
      candidates,
      randomSelection: result.randomSelection
        ? {
            wasRandom: result.randomSelection.wasRandom,
            originalRank: result.randomSelection.originalRank,
            candidateCount: result.randomSelection.candidateCount,
            randomFactor: params.randomFactor,
          }
        : undefined,
      depthHistory,
      searchStats: result.stats,
      forcedMove: result.forcedMove,
      timePressureFallback: result.timePressureFallback,
    };

    self.postMessage(response);
  } catch (error) {
    // エラー時はデフォルト位置を返す
    console.error("CPU Worker error:", error);
    const response: CpuResponse = {
      position: { row: 7, col: 7 },
      score: 0,
      thinkingTime: 0,
      depth: 0,
    };
    self.postMessage(response);
  }
};

// TypeScript用の型宣言
export type { CpuRequest, CpuResponse };
