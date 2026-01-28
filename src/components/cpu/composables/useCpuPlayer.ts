/**
 * CPU Player Composable
 *
 * Web Workerを使用してAIの着手を非同期で取得
 */

import { ref, onUnmounted, type Ref } from "vue";

import type { AIRequest, AIResponse, CpuDifficulty } from "@/types/cpu";
import type { BoardState } from "@/types/game";

// Viteの?workerサフィックスでWorkerをインポート
import RenjuAIWorker from "@/logic/cpuAI/renjuAI.worker?worker";

/**
 * useCpuPlayerの戻り値
 */
export interface UseCpuPlayerReturn {
  /** 思考中かどうか */
  isThinking: Ref<boolean>;
  /** 最後のレスポンス */
  lastResponse: Ref<AIResponse | null>;
  /** 着手をリクエスト */
  requestMove: (
    board: BoardState,
    currentTurn: "black" | "white",
    difficulty: CpuDifficulty,
  ) => Promise<AIResponse>;
  /** Workerを終了 */
  terminate: () => void;
}

/**
 * CPU Player Composable
 *
 * @returns Worker管理とAI着手リクエスト機能
 */
export function useCpuPlayer(): UseCpuPlayerReturn {
  const isThinking = ref(false);
  const lastResponse = ref<AIResponse | null>(null);

  let worker: Worker | null = null;
  let pendingResolve: ((response: AIResponse) => void) | null = null;

  /**
   * Workerを初期化
   */
  function initWorker(): Worker {
    if (worker) {
      return worker;
    }

    worker = new RenjuAIWorker();
    worker.onmessage = (event: MessageEvent<AIResponse>) => {
      const response = event.data;
      lastResponse.value = response;
      isThinking.value = false;

      if (pendingResolve) {
        pendingResolve(response);
        pendingResolve = null;
      }
    };

    worker.onerror = (error) => {
      console.error("AI Worker error:", error);
      isThinking.value = false;

      // エラー時はデフォルト位置を返す
      const defaultResponse: AIResponse = {
        position: { row: 7, col: 7 },
        score: 0,
        thinkingTime: 0,
        depth: 0,
      };
      lastResponse.value = defaultResponse;

      if (pendingResolve) {
        pendingResolve(defaultResponse);
        pendingResolve = null;
      }
    };

    return worker;
  }

  /**
   * AIに着手をリクエスト
   */
  function requestMove(
    board: BoardState,
    currentTurn: "black" | "white",
    difficulty: CpuDifficulty,
  ): Promise<AIResponse> {
    return new Promise((resolve) => {
      const w = initWorker();
      isThinking.value = true;
      pendingResolve = resolve;

      const request: AIRequest = {
        board,
        currentTurn,
        difficulty,
      };

      w.postMessage(request);
    });
  }

  /**
   * Workerを終了
   */
  function terminate(): void {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    pendingResolve = null;
    isThinking.value = false;
  }

  // コンポーネントのアンマウント時にWorkerを終了
  onUnmounted(() => {
    terminate();
  });

  return {
    isThinking,
    lastResponse,
    requestMove,
    terminate,
  };
}
