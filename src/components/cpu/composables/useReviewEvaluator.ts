/**
 * 振り返り評価Composable
 *
 * Workerプールによる並列評価を管理
 * Phase 1: 全ワーカーで並列評価（VCTスキップ）
 * Phase 2: 全ワーカーでVCTチェックを並列実行
 * Phase 3: 遡及チェック（forcedLoss検出手から前の手を再チェック）
 */

import { ref, onUnmounted, type Ref } from "vue";

import type {
  FullEvalResult,
  LightEvalResult,
  ReviewEvalRequest,
  VCTCheckResult,
} from "@/types/review";

import ReviewWorker from "@/logic/cpu/review.worker?worker";
import { parseMove } from "@/logic/gameRecordParser";
import {
  buildBacktrackBranches,
  buildBacktrackSequence,
  isOpeningMove,
} from "@/logic/reviewLogic";
import { usePreferencesStore } from "@/stores/preferencesStore";

/** ディスパッチキューのソート: フル評価を先、軽量評価を後 */
export function sortReviewQueue(items: { isLightEval: boolean }[]): void {
  items.sort((a, b) => {
    if (a.isLightEval !== b.isLightEval) {
      return a.isLightEval ? 1 : -1;
    }
    return 0;
  });
}

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
    skipLastMove?: boolean,
  ): Promise<(FullEvalResult | LightEvalResult)[]> {
    const moves = moveHistory.trim().split(/\s+/);
    const lastMoveIndex = moves.length - 1;

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
      if (skipLastMove && i === lastMoveIndex) {
        continue;
      }
      const isPlayerMove = playerFirst ? i % 2 === 0 : i % 2 === 1;
      const isLightEval = analyzeAll ? false : !isPlayerMove;
      allMoveItems.push({ moveIndex: i, isLightEval });
    }

    // フル評価（重い手）を先にディスパッチし、軽量評価は後に回す
    // → 全ワーカーが同時に重い処理を行い、遊休時間を削減
    sortReviewQueue(allMoveItems);

    if (allMoveItems.length === 0) {
      return Promise.resolve([]);
    }

    const enablePV = usePreferencesStore().preciseAnalysis;
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
     * Phase 2: VCTチェックを全ワーカーで並列ディスパッチ
     *
     * Phase 1 の dispatch と同じ共有キュー + 完了時に次をディスパッチするパターン。
     * 結果は moveIndex で results 配列に格納されるため、完了順序は影響しない。
     */
    function dispatchVCTParallel(
      vctWorkers: Worker[],
      items: FullEvalResult[],
    ): void {
      const vctQueue = [...items];
      let vctCompleted = 0;

      function dispatchNextVCT(worker: Worker): void {
        if (cancelled) {
          return;
        }

        const item = vctQueue.shift();
        if (item === undefined) {
          // キューが空 → 全完了チェック
          // JS シングルスレッドのため vctCompleted === items.length を満たすのは
          // 最後の onmessage/onerror ハンドラから呼ばれた1回だけ
          if (vctCompleted === items.length) {
            if (enablePV) {
              // Phase 2 完了 → Phase 1b（精密再評価）→ Phase 3
              dispatchPrecisePass(pool);
            } else {
              // 高速モード: Phase 3 スキップ
              finishEvaluation();
            }
          }
          return;
        }

        worker.onmessage = (event: MessageEvent<VCTCheckResult>) => {
          if (cancelled) {
            return;
          }
          if (event.data.forcedLossType) {
            item.forcedLossType = event.data.forcedLossType;
            item.forcedLossSequence = event.data.forcedLossSequence;
            onVCTResult?.(item.moveIndex, event.data);
          }
          vctCompleted++;
          completedCount.value++;
          progress.value = completedCount.value / totalCount.value;
          dispatchNextVCT(worker);
        };

        worker.onerror = () => {
          vctCompleted++;
          completedCount.value++;
          progress.value = completedCount.value / totalCount.value;
          dispatchNextVCT(worker);
        };

        const request: ReviewEvalRequest = {
          moveHistory,
          moveIndex: item.moveIndex,
          playerFirst,
          vctCheckOnly: true,
        };
        worker.postMessage(request);
      }

      // 全ワーカーに初期ディスパッチ
      for (const w of vctWorkers) {
        dispatchNextVCT(w);
      }
    }

    /**
     * Phase 3: 候補深掘りチェック（全ワーカー並列）
     *
     * forcedLossType が付いたプレイヤーの手の候補に対し、
     * 深い VCT 設定で opponentForcedWin を再検証する。
     * 全候補が負けなら前の手に遡り、生存する候補がある手が敗着。
     *
     * 決定論性: 生存候補発見時に早期打ち切りを維持し、
     * 生存候補以降の候補への書き込みをスキップすることで
     * 逐次実行と同一の結果を保証する。
     */
    /**
     * Phase 1b: 敗着近辺の精密再評価
     *
     * Pass 1 の高速結果から敗着を暫定特定し、
     * 敗着とその前のプレイヤー手のみ PRECISE プロファイルで再評価する。
     */
    function dispatchPrecisePass(preciseWorkers: Worker[]): void {
      // 敗着を暫定特定: forcedLossType を持つ最も早いプレイヤー手
      const sortedResults = [...results].sort(
        (a, b) => a.moveIndex - b.moveIndex,
      );
      let losingMoveIdx: number | null = null;
      for (const r of sortedResults) {
        const isPlayerMove = playerFirst
          ? r.moveIndex % 2 === 0
          : r.moveIndex % 2 === 1;
        if (isPlayerMove && r.mode === "fullEval" && r.forcedLossType) {
          losingMoveIdx = r.moveIndex;
          break;
        }
      }

      if (losingMoveIdx === null) {
        // 敗着なし → Phase 3 スキップ
        finishEvaluation();
        return;
      }

      // 敗着 + その前 1 手（プレイヤー手のみ）を精密化対象に
      const preciseTargetIndices: number[] = [];
      const playerMoveIndices = sortedResults
        .filter((r) => {
          const isPlayer = playerFirst
            ? r.moveIndex % 2 === 0
            : r.moveIndex % 2 === 1;
          return isPlayer && r.mode === "fullEval";
        })
        .map((r) => r.moveIndex)
        .filter((idx) => idx <= losingMoveIdx!);

      // 敗着から逆順に 2 手まで
      const reversed = [...playerMoveIndices].reverse();
      for (let i = 0; i < Math.min(2, reversed.length); i++) {
        preciseTargetIndices.push(reversed[i]!);
      }

      if (preciseTargetIndices.length === 0) {
        finishEvaluation();
        return;
      }

      // 精密再評価のディスパッチ
      const preciseQueue = [...preciseTargetIndices];
      let preciseCompleted = 0;
      totalCount.value += preciseTargetIndices.length;

      function dispatchNextPrecise(worker: Worker): void {
        if (cancelled) {
          return;
        }

        const moveIndex = preciseQueue.shift();
        if (moveIndex === undefined) {
          if (preciseCompleted === preciseTargetIndices.length) {
            // Phase 1b 完了 → forcedLoss 伝播 → 完了
            propagateForcedLossBackward();
            finishEvaluation();
          }
          return;
        }

        const request: ReviewEvalRequest = {
          moveHistory,
          moveIndex,
          playerFirst,
          preciseAnalysis: true,
        };

        worker.onmessage = (
          event: MessageEvent<FullEvalResult | LightEvalResult>,
        ) => {
          if (cancelled) {
            return;
          }
          // 高速結果を精密結果で上書き（Phase 2 VCT結果は保持）
          const idx = results.findIndex(
            (r) => r.moveIndex === event.data.moveIndex,
          );
          if (idx >= 0) {
            const oldResult = results[idx]!;
            const newResult = event.data;
            // Phase 2 で検出した forcedLoss を保持
            if (
              oldResult.mode === "fullEval" &&
              newResult.mode === "fullEval" &&
              oldResult.forcedLossType &&
              !newResult.forcedLossType
            ) {
              newResult.forcedLossType = oldResult.forcedLossType;
              newResult.forcedLossSequence = oldResult.forcedLossSequence;
            }
            results[idx] = newResult;
          }
          onResult?.(event.data);
          preciseCompleted++;
          completedCount.value++;
          progress.value = completedCount.value / totalCount.value;
          dispatchNextPrecise(worker);
        };

        worker.onerror = () => {
          preciseCompleted++;
          completedCount.value++;
          progress.value = completedCount.value / totalCount.value;
          dispatchNextPrecise(worker);
        };

        worker.postMessage(request);
      }

      for (const w of preciseWorkers) {
        dispatchNextPrecise(w);
      }
    }

    /**
     * forcedLoss の後方伝播（軽量版）
     *
     * Phase 1b の verifyCandidates(Infinity) で全候補がチェック済みのため、
     * ワーカーリクエスト不要。全候補が opponentForcedWin の手から
     * 前のプレイヤー手に forcedLossType を伝播する。
     */
    function propagateForcedLossBackward(): void {
      const sortedResults = [...results].sort(
        (a, b) => a.moveIndex - b.moveIndex,
      );

      // forcedLossType を持つプレイヤー手を古い順に処理
      for (const r of sortedResults) {
        if (r.mode !== "fullEval" || !r.forcedLossType) {
          continue;
        }
        const isPlayerMove = playerFirst
          ? r.moveIndex % 2 === 0
          : r.moveIndex % 2 === 1;
        if (!isPlayerMove) {
          continue;
        }

        const fr = r as FullEvalResult;
        const candidates = fr.candidates ?? [];
        if (
          candidates.length === 0 ||
          !candidates.every((c) => c.opponentForcedWin)
        ) {
          continue;
        }

        // 全候補が被追詰 → 前のプレイヤー手に伝播
        const prevPlayer = sortedResults
          .filter((pr): pr is FullEvalResult => {
            if (pr.mode !== "fullEval") {
              return false;
            }
            const isPM = playerFirst
              ? pr.moveIndex % 2 === 0
              : pr.moveIndex % 2 === 1;
            return isPM && pr.moveIndex < fr.moveIndex;
          })
          .pop();

        if (prevPlayer && !prevPlayer.forcedLossType) {
          prevPlayer.forcedLossType = fr.forcedLossType;
          prevPlayer.forcedLossSequence = buildBacktrackSequence(
            moves,
            prevPlayer.moveIndex,
            fr.moveIndex,
            fr.forcedLossSequence,
          );
          const branches = buildBacktrackBranches(
            moves,
            prevPlayer.moveIndex,
            fr.moveIndex,
            candidates,
          );
          if (branches.length > 0) {
            prevPlayer.forcedLossBranches = branches;
          }
        }
      }
    }

    /**
     * Phase 2 で forcedLossType が付いた手の played candidate に
     * opponentForcedWin を伝播する。
     *
     * buildEvaluatedMove は Phase 1 コールバックと最終リビルドで2回呼ばれ、
     * candidates を直接 mutate するため、伝播は buildEvaluatedMove 内ではなく
     * 全 Phase 完了後に1回だけ行う。
     */
    function propagateForcedLossToCandidates(): void {
      for (const r of results) {
        if (r.mode !== "fullEval" || !r.forcedLossType) {
          continue;
        }
        const fr = r as FullEvalResult;
        const moveStr = moves[fr.moveIndex];
        if (!moveStr || !fr.candidates) {
          continue;
        }
        const pos = parseMove(moveStr);
        const cand = fr.candidates.find(
          (c) => c.position.row === pos.row && c.position.col === pos.col,
        );
        if (cand && !cand.opponentForcedWin) {
          cand.opponentForcedWin = fr.forcedLossType;
          cand.opponentForcedWinSequence = fr.forcedLossSequence;
        }
      }
    }

    /** 評価完了処理 */
    function finishEvaluation(): void {
      propagateForcedLossToCandidates();
      isEvaluating.value = false;
      resolveAll?.(results.sort((a, b) => a.moveIndex - b.moveIndex));
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
            dispatchVCTParallel(pool, vctItems);
          } else if (enablePV) {
            // Phase 2 スキップ → Phase 1b（精密再評価）→ Phase 3
            dispatchPrecisePass(pool);
          } else {
            // 高速モード: Phase 2/3 両方スキップ
            finishEvaluation();
          }
        }
        return;
      }

      // Phase 1 は常に FAST で評価（精密モード時は Phase 1b で敗着近辺のみ再評価）
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
