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
              // Phase 2 完了 → Phase 3（遡及チェック）開始
              dispatchBacktrack(pool);
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
    function dispatchBacktrack(backtrackWorkers: Worker[]): void {
      // forcedLossType が付いたプレイヤーの手を古い順に収集
      const sortedResults = [...results].sort(
        (a, b) => a.moveIndex - b.moveIndex,
      );
      const forcedLossMoves: FullEvalResult[] = [];
      for (const r of sortedResults) {
        const isPlayerMove = playerFirst
          ? r.moveIndex % 2 === 0
          : r.moveIndex % 2 === 1;
        if (isPlayerMove && r.mode === "fullEval" && r.forcedLossType) {
          forcedLossMoves.push(r as FullEvalResult);
        }
      }

      if (forcedLossMoves.length === 0) {
        finishEvaluation();
        return;
      }

      // 最も古い forcedLoss の手から開始
      let currentIdx = 0;
      processNextForcedLossMove();

      /** 全候補負けの手から前のプレイヤー手に forcedLossType を伝播 */
      function propagateToParent(move: FullEvalResult): void {
        const prevPlayer = sortedResults
          .filter((r): r is FullEvalResult => {
            if (r.mode !== "fullEval") {
              return false;
            }
            const isPM = playerFirst
              ? r.moveIndex % 2 === 0
              : r.moveIndex % 2 === 1;
            return isPM && r.moveIndex < move.moveIndex;
          })
          .pop();
        if (prevPlayer && !prevPlayer.forcedLossType) {
          prevPlayer.forcedLossType = move.forcedLossType;
          prevPlayer.forcedLossSequence = buildBacktrackSequence(
            moves,
            prevPlayer.moveIndex,
            move.moveIndex,
            move.forcedLossSequence,
          );
          const branches = buildBacktrackBranches(
            moves,
            prevPlayer.moveIndex,
            move.moveIndex,
            move.candidates ?? [],
          );
          if (branches.length > 0) {
            prevPlayer.forcedLossBranches = branches;
          }
          // 遡及先を次の処理対象にして再帰的にチェック
          forcedLossMoves.splice(currentIdx + 1, 0, prevPlayer);
        }
      }

      function processNextForcedLossMove(): void {
        if (cancelled || currentIdx >= forcedLossMoves.length) {
          finishEvaluation();
          return;
        }

        const move = forcedLossMoves[currentIdx]!;
        const candidates = move.candidates ?? [];

        // 候補がない → 次の手へ
        if (candidates.length === 0) {
          currentIdx++;
          processNextForcedLossMove();
          return;
        }

        // 既に全候補に opponentForcedWin が付いている → 深掘り不要、遡及のみ
        if (candidates.every((c) => c.opponentForcedWin)) {
          propagateToParent(move);
          currentIdx++;
          processNextForcedLossMove();
          return;
        }

        // opponentForcedWin が未設定の候補を深い VCT で並列チェック
        const unchecked = candidates.filter((c) => !c.opponentForcedWin);
        const candQueue = [...unchecked];
        let candCompleted = 0;
        let foundSurvivor = false;

        function dispatchNextCandidate(worker: Worker): void {
          if (cancelled || foundSurvivor) {
            return;
          }

          const cand = candQueue.shift();
          if (!cand) {
            // キューが空 → 全完了チェック（in-flight ワーカー完了を待つ）
            if (candCompleted === unchecked.length) {
              const hasSurvivor = candidates.some((c) => !c.opponentForcedWin);
              if (hasSurvivor) {
                finishEvaluation();
              } else {
                propagateToParent(move);
                currentIdx++;
                processNextForcedLossMove();
              }
            }
            return;
          }

          worker.onmessage = (event: MessageEvent<VCTCheckResult>) => {
            if (cancelled) {
              return;
            }
            if (foundSurvivor) {
              // 生存候補発見済み → 書き込みスキップ
              candCompleted++;
              return;
            }
            if (event.data.forcedLossType) {
              cand.opponentForcedWin = event.data.forcedLossType;
              cand.opponentForcedWinSequence = event.data.forcedLossSequence;
            } else {
              // 生存候補発見 → 早期打ち切り
              foundSurvivor = true;
              finishEvaluation();
              return;
            }
            candCompleted++;
            dispatchNextCandidate(worker);
          };

          worker.onerror = () => {
            if (foundSurvivor) {
              candCompleted++;
              return;
            }
            candCompleted++;
            dispatchNextCandidate(worker);
          };

          const request: ReviewEvalRequest = {
            moveHistory,
            moveIndex: move.moveIndex,
            playerFirst,
            vctCheckOnly: true,
            skipStoneThreshold: true,
            candidatePosition: cand.position,
          };
          worker.postMessage(request);
        }

        // 全ワーカーに初期ディスパッチ
        for (const w of backtrackWorkers) {
          dispatchNextCandidate(w);
        }
      }
    }

    /**
     * Phase 2/3 で forcedLossType が付いた手の played candidate に
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
            // Phase 2 スキップ → Phase 3 へ直接
            dispatchBacktrack(pool);
          } else {
            // 高速モード: Phase 2/3 両方スキップ
            finishEvaluation();
          }
        }
        return;
      }

      const request: ReviewEvalRequest = {
        moveHistory,
        moveIndex: item.moveIndex,
        playerFirst,
        isLightEval: item.isLightEval || undefined,
        preciseAnalysis: enablePV,
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
