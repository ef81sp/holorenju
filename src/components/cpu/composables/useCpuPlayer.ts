/**
 * CPU Player Composable
 *
 * Web Workerを使用してCPUの着手を非同期で取得
 */

import { ref, onUnmounted, type Ref } from "vue";

import type { CpuRequest, CpuResponse, CpuDifficulty } from "@/types/cpu";
import type { BoardState } from "@/types/game";

// Viteの?workerサフィックスでWorkerをインポート
import CpuWorker from "@/logic/cpu/cpu.worker?worker";

/** CPUの着手を待つ最小時間（ミリ秒） */
const MIN_CPU_WAIT_MS = 2500;

/**
 * useCpuPlayerの戻り値
 */
export interface UseCpuPlayerReturn {
  /** 思考中かどうか */
  isThinking: Ref<boolean>;
  /** 最後のレスポンス */
  lastResponse: Ref<CpuResponse | null>;
  /** 着手をリクエスト */
  requestMove: (
    board: BoardState,
    currentTurn: "black" | "white",
    difficulty: CpuDifficulty,
    skipMinWait?: boolean,
  ) => Promise<CpuResponse>;
  /** Workerを終了 */
  terminate: () => void;
}

/**
 * CPU Player Composable
 *
 * @returns Worker管理とCPU着手リクエスト機能
 */
export function useCpuPlayer(): UseCpuPlayerReturn {
  const isThinking = ref(false);
  const lastResponse = ref<CpuResponse | null>(null);

  let worker: Worker | null = null;
  let pendingResolve: ((response: CpuResponse) => void) | null = null;

  /**
   * Workerを初期化
   */
  function initWorker(): Worker {
    if (worker) {
      return worker;
    }

    worker = new CpuWorker();
    worker.onmessage = (event: MessageEvent<CpuResponse>) => {
      const response = event.data;
      lastResponse.value = response;
      isThinking.value = false;

      if (pendingResolve) {
        pendingResolve(response);
        pendingResolve = null;
      }
    };

    worker.onerror = (error) => {
      console.error("CPU Worker error:", error);
      isThinking.value = false;

      // エラー時はデフォルト位置を返す
      const defaultResponse: CpuResponse = {
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
   * CPUに着手をリクエスト
   * @param skipMinWait trueの場合、最小待機時間をスキップして即座に結果を返す
   */
  function requestMove(
    board: BoardState,
    currentTurn: "black" | "white",
    difficulty: CpuDifficulty,
    skipMinWait = false,
  ): Promise<CpuResponse> {
    const workerPromise = new Promise<CpuResponse>((resolve) => {
      const w = initWorker();
      isThinking.value = true;
      pendingResolve = resolve;

      const request: CpuRequest = {
        board,
        currentTurn,
        difficulty,
      };

      w.postMessage(request);
    });

    // 設定で待機スキップ時はWorkerの結果のみ待つ
    if (skipMinWait) {
      return workerPromise;
    }

    // 両方完了するまで待つ = 遅い方まで待つ
    const minWaitPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, MIN_CPU_WAIT_MS);
    });

    return Promise.all([workerPromise, minWaitPromise]).then(
      ([response]) => response,
    );
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
