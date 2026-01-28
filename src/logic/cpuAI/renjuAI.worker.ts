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

import { findBestMoveIterative } from "./minimax";

/**
 * Worker内でのメッセージハンドラ
 *
 * Iterative Deepeningを使用して、時間制限内で可能な限り深く探索する
 */
self.onmessage = (event: MessageEvent<AIRequest>) => {
  const request = event.data;
  const startTime = performance.now();

  try {
    const params = DIFFICULTY_PARAMS[request.difficulty];

    // Iterative Deepeningで探索（時間制限付き）
    const result = findBestMoveIterative(
      request.board,
      request.currentTurn as "black" | "white",
      params.depth,
      params.timeLimit,
      params.randomFactor,
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
