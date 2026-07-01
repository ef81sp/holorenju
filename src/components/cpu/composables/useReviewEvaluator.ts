/**
 * 振り返り評価Composable
 *
 * Workerプールによる並列評価を管理
 * Phase 1: 全ワーカーで並列評価（VCTスキップ）
 * Phase 2: 全ワーカーでVCTチェックを並列実行
 * Phase 1b: 敗着近辺の精密再評価
 */

import { ref, onUnmounted, type Ref } from "vue";

import type {
  FullEvalResult,
  LightEvalResult,
  ReviewEvalRequest,
  VCTCheckResult,
} from "@/types/review";

import ReviewWorker from "@/logic/cpu/review.worker?worker";
import {
  findPreciseTargets,
  propagateForcedLossBackward,
  propagateForcedLossToCandidates,
} from "@/logic/cpu/review/forcedLossPropagation";
import {
  buildReviewQueue,
  sortReviewQueue as sortQueue,
} from "@/logic/cpu/review/reviewQueue";
import { runWorkerPool } from "@/logic/cpu/review/workerPoolDispatcher";
import { usePreferencesStore } from "@/stores/preferencesStore";

// re-export for backward compatibility
export { sortReviewQueue } from "@/logic/cpu/review/reviewQueue";

/** Workerプールサイズ（最大8、最低2） */
const POOL_SIZE = Math.max(2, Math.min(8, navigator.hardwareConcurrency ?? 4));

/**
 * Worker が応答しないと判定するまでの猶予（ms）。
 *
 * 目的は iOS Safari のメモリ圧迫による silent kill から復帰することであり、
 * 健全だが探索の長い手を誤 kill してはいけない。
 * 関連する探索側 time budget（すべて bounded 済み, #104）:
 * - FAST minimax: absoluteTimeLimit 10s
 * - PRECISE minimax: absoluteTimeLimit 20s
 * - Phase 2 VCT: 10s + VCF 3s
 * - REVIEW_VCT_OPTIONS_WITH_BRANCHES: 10s
 * - forcedWinDetection fallback: 5s/手
 * - verifyCandidates: 5s
 * → 単発タスク worst case ≒ 55s、8 並列 CPU 競合込みで 90s 程度
 *
 * 120s は上記に 30% 程度の安全余裕を持たせつつ、真の hang を過度に待たせない値。
 */
const WORKER_WATCHDOG_MS = 120_000;

/** watchdog タイムアウト後、同一タスクを再投入する最大回数 */
const WORKER_MAX_RETRIES = 1;

export interface UseReviewEvaluatorReturn {
  /** 評価中かどうか */
  isEvaluating: Ref<boolean>;
  /** 進捗（0-1） */
  progress: Ref<number>;
  /** 完了した手数 */
  completedCount: Ref<number>;
  /** 評価する総手数 */
  totalCount: Ref<number>;
  /** 再試行を含めても応答が返らなかった手数（silent kill 判定） */
  failedCount: Ref<number>;
  /** 全プレイヤーの手を並列評価 */
  evaluate: (
    moveHistory: string,
    playerFirst: boolean,
    analyzeAll?: boolean,
    onResult?: (result: FullEvalResult | LightEvalResult) => void,
    onVCTResult?: (moveIndex: number, result: VCTCheckResult) => void,
    skipLastMove?: boolean,
  ) => Promise<(FullEvalResult | LightEvalResult)[]>;
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
  const failedCount = ref(0);

  let workers: Worker[] = [];
  let cancelled = false;
  let cancelResolve: (() => void) | null = null;

  function initPool(): Worker[] {
    if (workers.length > 0) {
      return workers;
    }
    for (let i = 0; i < POOL_SIZE; i++) {
      workers.push(new ReviewWorker());
    }
    return workers;
  }

  function destroyPool(): void {
    for (const w of workers) {
      w.terminate();
    }
    workers = [];
  }

  function createReplacementWorker(): Worker {
    return new ReviewWorker();
  }

  /** 進捗を1手分進める */
  function advanceProgress(): void {
    completedCount.value++;
    progress.value = completedCount.value / totalCount.value;
  }

  /**
   * 全プレイヤーの手を並列評価
   */
  async function evaluate(
    moveHistory: string,
    playerFirst: boolean,
    analyzeAll?: boolean,
    onResult?: (result: FullEvalResult | LightEvalResult) => void,
    onVCTResult?: (moveIndex: number, result: VCTCheckResult) => void,
    skipLastMove?: boolean,
  ): Promise<(FullEvalResult | LightEvalResult)[]> {
    const moves = moveHistory.trim().split(/\s+/);

    const allMoveItems = buildReviewQueue(
      moves,
      playerFirst,
      analyzeAll,
      skipLastMove,
    );
    sortQueue(allMoveItems);

    if (allMoveItems.length === 0) {
      return [];
    }

    const enablePV = usePreferencesStore().preciseAnalysis;
    cancelled = false;
    isEvaluating.value = true;
    completedCount.value = 0;
    totalCount.value = allMoveItems.length;
    progress.value = 0;
    failedCount.value = 0;

    const pool = initPool();
    const results: (FullEvalResult | LightEvalResult)[] = [];
    const isCancelled = (): boolean => cancelled;

    /** watchdog 共通設定（silent kill 対策、#104） */
    const watchdogConfig = {
      timeoutMs: WORKER_WATCHDOG_MS,
      maxRetries: WORKER_MAX_RETRIES,
      createWorker: createReplacementWorker,
      onTaskFailed: (): void => {
        failedCount.value++;
      },
    };

    // キャンセル時に runWorkerPool の await を解除するための Promise
    const cancelPromise = new Promise<void>((resolve) => {
      cancelResolve = resolve;
    });

    /** runWorkerPool をキャンセル可能にラップ */
    async function runCancellable<TItem, TResult>(
      ...args: Parameters<typeof runWorkerPool<TItem, TResult>>
    ): Promise<void> {
      await Promise.race([runWorkerPool(...args), cancelPromise]);
    }

    // Phase 1: 全手を FAST プロファイルで評価
    await runCancellable(pool, allMoveItems, {
      buildRequest: (item) => {
        const request: ReviewEvalRequest = {
          moveHistory,
          moveIndex: item.moveIndex,
          playerFirst,
          isLightEval: item.isLightEval || undefined,
        };
        return request;
      },
      handleResult: (_item, data: FullEvalResult | LightEvalResult) => {
        results.push(data);
        onResult?.(data);
      },
      onProgress: advanceProgress,
      isCancelled,
      ...watchdogConfig,
    });

    if (cancelled) {
      return [];
    }

    // Phase 2: VCTチェック
    const vctItems = results.filter(
      (r): r is FullEvalResult =>
        r.mode === "fullEval" && Boolean(r.needsVCTCheck),
    );

    if (vctItems.length > 0) {
      totalCount.value += vctItems.length;

      await runCancellable(pool, vctItems, {
        buildRequest: (item) => {
          const request: ReviewEvalRequest = {
            moveHistory,
            moveIndex: item.moveIndex,
            playerFirst,
            vctCheckOnly: true,
          };
          return request;
        },
        handleResult: (item, data: VCTCheckResult) => {
          if (data.forcedLossType) {
            item.forcedLossType = data.forcedLossType;
            item.forcedLossSequence = data.forcedLossSequence;
            onVCTResult?.(item.moveIndex, data);
          }
        },
        onProgress: advanceProgress,
        isCancelled,
        ...watchdogConfig,
      });
    }

    if (cancelled) {
      return [];
    }

    // Phase 1b: 敗着近辺の精密再評価
    if (enablePV) {
      const preciseTargetIndices = findPreciseTargets(results, playerFirst);

      if (preciseTargetIndices.length > 0) {
        totalCount.value += preciseTargetIndices.length;

        await runCancellable(pool, preciseTargetIndices, {
          buildRequest: (moveIndex) => {
            const request: ReviewEvalRequest = {
              moveHistory,
              moveIndex,
              playerFirst,
              preciseAnalysis: true,
            };
            return request;
          },
          handleResult: (
            _moveIndex,
            data: FullEvalResult | LightEvalResult,
          ) => {
            // 高速結果を精密結果で上書き（Phase 2 VCT結果は保持）
            const idx = results.findIndex(
              (r) => r.moveIndex === data.moveIndex,
            );
            if (idx >= 0) {
              const oldResult = results[idx]!;
              if (
                oldResult.mode === "fullEval" &&
                data.mode === "fullEval" &&
                oldResult.forcedLossType &&
                !data.forcedLossType
              ) {
                data.forcedLossType = oldResult.forcedLossType;
                data.forcedLossSequence = oldResult.forcedLossSequence;
              }
              results[idx] = data;
            }
            onResult?.(data);
          },
          onProgress: advanceProgress,
          isCancelled,
          ...watchdogConfig,
        });
      }

      if (!cancelled) {
        propagateForcedLossBackward(results, playerFirst, moves);
      }
    }

    if (cancelled) {
      return [];
    }

    // 候補手への forcedLoss 伝播
    propagateForcedLossToCandidates(results, moves);

    isEvaluating.value = false;
    return results.sort((a, b) => a.moveIndex - b.moveIndex);
  }

  function cancel(): void {
    cancelled = true;
    isEvaluating.value = false;
    cancelResolve?.();
    cancelResolve = null;
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
    failedCount,
    evaluate,
    cancel,
  };
}
