/**
 * Renju AI Web Worker
 *
 * AIをメインスレッドから分離してUIブロッキングを回避
 *
 * Viteの?workerサフィックスでインポートして使用:
 * import RenjuAIWorker from './renjuAI.worker?worker'
 */

import {
  DIFFICULTY_PARAMS,
  type AIRequest,
  type AIResponse,
} from "@/types/cpu";

import { countStones } from "./core/boardUtils";
import { getOpeningMove, isOpeningPhase } from "./opening";
import { findBestMoveIterativeWithTT } from "./search/minimax";

/**
 * Worker内でのメッセージハンドラ
 *
 * 開局フェーズ（1〜3手目）では珠型パターンを使用し、
 * 4手目以降はIterative Deepeningで探索する
 */
self.onmessage = (event: MessageEvent<AIRequest>) => {
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

          const response: AIResponse = {
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

    // 4手目以降、または開局パターン外の場合は通常のAI探索
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
    );

    const endTime = performance.now();
    const thinkingTime = Math.round(endTime - startTime);

    const response: AIResponse = {
      position: result.position,
      score: result.score,
      thinkingTime,
      depth: result.completedDepth,
    };

    self.postMessage(response);
  } catch (error) {
    // エラー時はデフォルト位置を返す
    console.error("AI Worker error:", error);
    const response: AIResponse = {
      position: { row: 7, col: 7 },
      score: 0,
      thinkingTime: 0,
      depth: 0,
    };
    self.postMessage(response);
  }
};

// TypeScript用の型宣言
export type { AIRequest, AIResponse };
