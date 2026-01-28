/**
 * Renju AI Web Worker
 *
 * AIをメインスレッドから分離してUIブロッキングを回避
 *
 * Viteの?workerサフィックスでインポートして使用:
 * import RenjuAIWorker from './renjuAI.worker?worker'
 */

import type { BoardState } from "@/types/game";
import type { AIRequest, AIResponse, CpuDifficulty } from "@/types/cpu";

import { findBestMove } from "./minimax";
import { DIFFICULTY_PARAMS } from "@/types/cpu";

/**
 * Worker内でのメッセージハンドラ
 */
self.onmessage = (event: MessageEvent<AIRequest>) => {
  const request = event.data;
  const startTime = performance.now();

  try {
    const params = DIFFICULTY_PARAMS[request.difficulty];
    const result = findBestMove(
      request.board,
      request.currentTurn as "black" | "white",
      params.depth,
      params.randomFactor,
    );

    const endTime = performance.now();
    const thinkingTime = Math.round(endTime - startTime);

    const response: AIResponse = {
      position: result.position,
      score: result.score,
      thinkingTime,
      depth: params.depth,
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
