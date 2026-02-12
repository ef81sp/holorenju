/**
 * 振り返り評価Composable
 *
 * Workerプールによる並列評価を管理
 */

import { ref, onUnmounted, type Ref } from "vue";

import type { ReviewEvalRequest, ReviewWorkerResult } from "@/types/review";

import ReviewWorker from "@/logic/cpu/review.worker?worker";
import { isOpeningMove } from "@/logic/reviewLogic";

/** Workerプールサイズ（最大8、最低2） */
const POOL_SIZE = Math.max(2, Math.min(8, navigator.hardwareConcurrency ?? 4));

export interface UseReviewEvaluatorReturn {
  /** 評価中かどうか */
  isEvaluating: Ref<boolean>;
  /** 進捗（0-1） */
  progress: Ref<number>;
  /** 完了した手数 */
  completedCount: Ref<number>;
  /** 評価する総手数 */
  totalCount: Ref<number>;
  /** 全プレイヤーの手を並列評価 */
  evaluate: (
    moveHistory: string,
    playerFirst: boolean,
  ) => Promise<ReviewWorkerResult[]>;
  /** 評価をキャンセル */
  cancel: () => void;
}

/**
 * 振り返り評価Composable
 */
export function useReviewEvaluator(): UseReviewEvaluatorReturn {
  const isEvaluating = ref(false);
  const progress = ref(0);
  const completedCount = ref(0);
  const totalCount = ref(0);

  let workers: Worker[] = [];
  let cancelled = false;

  /**
   * Workerプールを初期化
   */
  function initPool(): Worker[] {
    if (workers.length > 0) {
      return workers;
    }
    for (let i = 0; i < POOL_SIZE; i++) {
      workers.push(new ReviewWorker());
    }
    return workers;
  }

  /**
   * Workerプールを破棄
   */
  function destroyPool(): void {
    for (const w of workers) {
      w.terminate();
    }
    workers = [];
  }

  /**
   * 全プレイヤーの手を並列評価
   */
  function evaluate(
    moveHistory: string,
    playerFirst: boolean,
  ): Promise<ReviewWorkerResult[]> {
    const moves = moveHistory.trim().split(/\s+/);

    // プレイヤーの手のインデックスを収集（珠型の3手は除外）
    const playerMoveIndices: number[] = [];
    for (let i = 0; i < moves.length; i++) {
      if (isOpeningMove(i)) {
        continue;
      }
      const isPlayerMove = playerFirst ? i % 2 === 0 : i % 2 === 1;
      if (isPlayerMove) {
        playerMoveIndices.push(i);
      }
    }

    if (playerMoveIndices.length === 0) {
      return Promise.resolve([]);
    }

    cancelled = false;
    isEvaluating.value = true;
    completedCount.value = 0;
    totalCount.value = playerMoveIndices.length;
    progress.value = 0;

    const pool = initPool();
    const results: ReviewWorkerResult[] = [];
    const queue = [...playerMoveIndices];
    let resolveAll: ((results: ReviewWorkerResult[]) => void) | null = null;

    const promise = new Promise<ReviewWorkerResult[]>((resolve) => {
      resolveAll = resolve;
    });

    /**
     * 空きWorkerに次のタスクをディスパッチ
     */
    function dispatch(worker: Worker): void {
      if (cancelled) {
        return;
      }

      const moveIndex = queue.shift();
      if (moveIndex === undefined) {
        // キューが空 → 全完了チェック
        if (completedCount.value === totalCount.value) {
          isEvaluating.value = false;
          const sorted = results.sort((a, b) => a.moveIndex - b.moveIndex);
          resolveAll?.(sorted);
        }
        return;
      }

      const request: ReviewEvalRequest = {
        moveHistory,
        moveIndex,
        playerFirst,
      };

      worker.onmessage = (event: MessageEvent<ReviewWorkerResult>) => {
        if (cancelled) {
          return;
        }
        results.push(event.data);
        completedCount.value++;
        progress.value = completedCount.value / totalCount.value;

        // 次のタスクをディスパッチ
        dispatch(worker);
      };

      worker.onerror = (error) => {
        console.error("Review Worker error:", error);
        completedCount.value++;
        progress.value = completedCount.value / totalCount.value;
        dispatch(worker);
      };

      worker.postMessage(request);
    }

    // 全Workerにタスクを初期ディスパッチ
    for (const w of pool) {
      dispatch(w);
    }

    return promise;
  }

  /**
   * 評価をキャンセル
   */
  function cancel(): void {
    cancelled = true;
    isEvaluating.value = false;
    destroyPool();
  }

  onUnmounted(() => {
    cancel();
  });

  return {
    isEvaluating,
    progress,
    completedCount,
    totalCount,
    evaluate,
    cancel,
  };
}
