/**
 * 振り返り評価Composable
 *
 * Workerプールによる並列評価を管理
 * Phase 1: 全ワーカーで並列評価（VCTスキップ）
 * Phase 2: 単一ワーカーでVCTチェックを逐次実行
 */

import { ref, onUnmounted, type Ref } from "vue";

import type {
  FullEvalResult,
  LightEvalResult,
  ReviewEvalRequest,
  VCTCheckResult,
} from "@/types/review";

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
    analyzeAll?: boolean,
    onResult?: (result: FullEvalResult | LightEvalResult) => void,
    onVCTResult?: (moveIndex: number, result: VCTCheckResult) => void,
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

  let workers: Worker[] = [];
  let cancelled = false;
  let resolveAll:
    | ((results: (FullEvalResult | LightEvalResult)[]) => void)
    | null = null;

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
    analyzeAll?: boolean,
    onResult?: (result: FullEvalResult | LightEvalResult) => void,
    onVCTResult?: (moveIndex: number, result: VCTCheckResult) => void,
  ): Promise<(FullEvalResult | LightEvalResult)[]> {
    const moves = moveHistory.trim().split(/\s+/);

    // 珠型(3手)以降の全手をキューに入れる
    // プレイヤー手: isLightEval=false（フル評価）
    // コンピュータ手: isLightEval=true（強制勝ち検出のみ）
    // analyzeAll時は全手をフル評価
    interface QueueItem {
      moveIndex: number;
      isLightEval: boolean;
    }
    const allMoveItems: QueueItem[] = [];
    for (let i = 0; i < moves.length; i++) {
      if (isOpeningMove(i)) {
        continue;
      }
      const isPlayerMove = playerFirst ? i % 2 === 0 : i % 2 === 1;
      const isLightEval = analyzeAll ? false : !isPlayerMove;
      allMoveItems.push({ moveIndex: i, isLightEval });
    }

    if (allMoveItems.length === 0) {
      return Promise.resolve([]);
    }

    cancelled = false;
    isEvaluating.value = true;
    completedCount.value = 0;
    totalCount.value = allMoveItems.length;
    progress.value = 0;

    const pool = initPool();
    const results: (FullEvalResult | LightEvalResult)[] = [];
    const queue = [...allMoveItems];

    const promise = new Promise<(FullEvalResult | LightEvalResult)[]>(
      (resolve) => {
        resolveAll = resolve;
      },
    );

    /**
     * Phase 2: VCTチェックを逐次ディスパッチ
     */
    function dispatchVCT(
      worker: Worker,
      items: FullEvalResult[],
      index: number,
    ): void {
      if (cancelled || index >= items.length) {
        isEvaluating.value = false;
        resolveAll?.(results.sort((a, b) => a.moveIndex - b.moveIndex));
        return;
      }

      const item = items[index];
      if (!item) {
        dispatchVCT(worker, items, index + 1);
        return;
      }
      worker.onmessage = (event: MessageEvent<VCTCheckResult>) => {
        if (cancelled) {
          return;
        }
        if (event.data.forcedLossType) {
          onVCTResult?.(item.moveIndex, event.data);
        }
        completedCount.value++;
        progress.value = completedCount.value / totalCount.value;
        dispatchVCT(worker, items, index + 1);
      };

      worker.onerror = () => {
        completedCount.value++;
        progress.value = completedCount.value / totalCount.value;
        dispatchVCT(worker, items, index + 1);
      };

      const request: ReviewEvalRequest = {
        moveHistory,
        moveIndex: item.moveIndex,
        playerFirst,
        vctCheckOnly: true,
      };
      worker.postMessage(request);
    }

    /**
     * 空きWorkerに次のタスクをディスパッチ
     */
    function dispatch(worker: Worker): void {
      if (cancelled) {
        return;
      }

      const item = queue.shift();
      if (item === undefined) {
        // キューが空 → 全完了チェック
        if (completedCount.value === totalCount.value) {
          // Phase 1 完了 → Phase 2 開始チェック
          const vctItems = results.filter(
            (r): r is FullEvalResult =>
              r.mode === "fullEval" && Boolean(r.needsVCTCheck),
          );
          if (vctItems.length > 0) {
            totalCount.value += vctItems.length;
            const [vctWorker] = pool;
            if (vctWorker) {
              dispatchVCT(vctWorker, vctItems, 0);
            }
          } else {
            isEvaluating.value = false;
            const sorted = results.sort((a, b) => a.moveIndex - b.moveIndex);
            resolveAll?.(sorted);
          }
        }
        return;
      }

      const request: ReviewEvalRequest = {
        moveHistory,
        moveIndex: item.moveIndex,
        playerFirst,
        isLightEval: item.isLightEval || undefined,
      };

      worker.onmessage = (
        event: MessageEvent<FullEvalResult | LightEvalResult>,
      ) => {
        if (cancelled) {
          return;
        }
        results.push(event.data);
        onResult?.(event.data);
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
    resolveAll?.([]);
    resolveAll = null;
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
