/**
 * 汎用ワーカープールディスパッチャー
 *
 * 共有キューからタスクを取り出し、空きワーカーに1つずつ割り当てる。
 * 全タスク完了で Promise を resolve する。
 *
 * timeoutMs + createWorker 併用時は watchdog が有効。応答が来ない Worker を
 * terminate し、新規 Worker で最大 maxRetries 回まで再投入する。
 * （iPad Safari のメモリ圧迫で Worker が silent kill されるケース対策 #104）
 */

/** ワーカーの抽象インターフェース（テスト時にモック可能） */
export interface WorkerLike {
  postMessage(data: unknown): void;
  terminate(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onmessage: ((event: MessageEvent) => any) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onerror: ((event: ErrorEvent) => any) | null;
}

/** ディスパッチ設定 */
export interface DispatchConfig<TItem, TResult> {
  /** タスクからワーカーリクエストを構築 */
  buildRequest: (item: TItem) => unknown;
  /** ワーカー結果を処理 */
  handleResult: (item: TItem, data: TResult) => void;
  /** タスク完了ごとに呼ばれる進捗コールバック */
  onProgress?: () => void;
  /** キャンセル判定（true で新規ディスパッチ停止） */
  isCancelled?: () => boolean;
  /**
   * Worker が応答しないと判定するまでのミリ秒。
   * createWorker と併用時のみ watchdog が有効。
   */
  timeoutMs?: number;
  /**
   * タイムアウト時の最大再試行回数（既定 0）。
   * 1 なら最大 2 回試行し、超過したら onTaskFailed を呼ぶ。
   */
  maxRetries?: number;
  /** タイムアウト時に死亡した Worker と差し替える新規 Worker を作成 */
  createWorker?: () => WorkerLike;
  /** 再試行を使い切ってもタスクが完了しなかった場合の通知 */
  onTaskFailed?: (item: TItem) => void;
}

/**
 * ワーカープールでタスクを並列実行する
 *
 * items をコピーしたキューから各ワーカーに1タスクずつ割り当て、
 * 完了したワーカーに次のタスクを割り当てる。全タスク完了で resolve。
 * キャンセル時は in-flight タスクの完了を待ってから resolve。
 *
 * 副作用: watchdog 発火時に呼び出し側の `workers` 配列を in-place で書き換える
 * （死亡想定 Worker のスロットを新規 Worker で置換）。
 */
export function runWorkerPool<TItem, TResult>(
  workers: WorkerLike[],
  items: TItem[],
  config: DispatchConfig<TItem, TResult>,
): Promise<void> {
  if (items.length === 0) {
    return Promise.resolve();
  }

  if (config.timeoutMs !== undefined && !config.createWorker) {
    // 設定漏れを silent-noop で吸収しない。開発中に即気付けるよう throw。
    throw new Error(
      "runWorkerPool: timeoutMs is set but createWorker is missing — watchdog cannot respawn dead worker",
    );
  }

  return new Promise<void>((resolve) => {
    const queue = [...items];
    let completed = 0;
    let inFlight = 0;
    const total = items.length;
    const attempts = new Map<TItem, number>();
    const watchdogEnabled =
      config.timeoutMs !== undefined && Boolean(config.createWorker);
    const maxRetries = config.maxRetries ?? 0;

    function tryResolve(): void {
      if (inFlight === 0 && (completed === total || config.isCancelled?.())) {
        resolve();
      }
    }

    function finishTask(): void {
      completed++;
    }

    function dispatchNext(worker: WorkerLike): void {
      if (config.isCancelled?.()) {
        tryResolve();
        return;
      }

      const item = queue.shift();
      if (item === undefined) {
        tryResolve();
        return;
      }

      inFlight++;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let settled = false;

      const clearWatchdog = (): void => {
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      worker.onmessage = (event: MessageEvent<TResult>) => {
        if (settled) {
          return;
        }
        settled = true;
        clearWatchdog();
        inFlight--;
        if (!config.isCancelled?.()) {
          config.handleResult(item, event.data);
          config.onProgress?.();
        }
        finishTask();
        dispatchNext(worker);
      };

      worker.onerror = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearWatchdog();
        inFlight--;
        if (!config.isCancelled?.()) {
          config.onProgress?.();
        }
        finishTask();
        dispatchNext(worker);
      };

      if (watchdogEnabled) {
        timeoutHandle = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          timeoutHandle = null;

          try {
            worker.terminate();
          } catch {
            // 既に terminate 済みの可能性は無視
          }
          inFlight--;

          // cancel 済みなら新規 Worker を作らずに即終了（iOS メモリ節約が本件目的）
          if (config.isCancelled?.()) {
            finishTask();
            tryResolve();
            return;
          }

          // 死亡想定 Worker のスロットを新規 Worker で置換
          const slot = workers.indexOf(worker);
          const replacement = config.createWorker!();
          if (slot >= 0) {
            workers[slot] = replacement;
          }

          const nextAttempt = (attempts.get(item) ?? 0) + 1;
          attempts.set(item, nextAttempt);

          if (nextAttempt <= maxRetries) {
            // 再試行: キュー先頭に戻して同じ Worker スロットで再投入
            queue.unshift(item);
          } else {
            // 上限到達: 失敗として計上して進捗を進める
            config.onTaskFailed?.(item);
            config.onProgress?.();
            finishTask();
          }
          dispatchNext(replacement);
        }, config.timeoutMs);
      }

      worker.postMessage(config.buildRequest(item));
    }

    for (const w of workers) {
      dispatchNext(w);
    }
  });
}
