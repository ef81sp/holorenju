/**
 * 汎用ワーカープールディスパッチャー
 *
 * 共有キューからタスクを取り出し、空きワーカーに1つずつ割り当てる。
 * 全タスク完了で Promise を resolve する。
 */

/** ワーカーの抽象インターフェース（テスト時にモック可能） */
export interface WorkerLike {
  postMessage(data: unknown): void;
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
}

/**
 * ワーカープールでタスクを並列実行する
 *
 * items をコピーしたキューから各ワーカーに1タスクずつ割り当て、
 * 完了したワーカーに次のタスクを割り当てる。全タスク完了で resolve。
 * キャンセル時は in-flight タスクの完了を待ってから resolve。
 */
export function runWorkerPool<TItem, TResult>(
  workers: WorkerLike[],
  items: TItem[],
  config: DispatchConfig<TItem, TResult>,
): Promise<void> {
  if (items.length === 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const queue = [...items];
    let completed = 0;
    let inFlight = 0;
    const total = items.length;

    function tryResolve(): void {
      if (inFlight === 0 && (completed === total || config.isCancelled?.())) {
        resolve();
      }
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

      worker.onmessage = (event: MessageEvent<TResult>) => {
        inFlight--;
        if (!config.isCancelled?.()) {
          config.handleResult(item, event.data);
          config.onProgress?.();
        }
        completed++;
        dispatchNext(worker);
      };

      worker.onerror = () => {
        inFlight--;
        if (!config.isCancelled?.()) {
          config.onProgress?.();
        }
        completed++;
        dispatchNext(worker);
      };

      worker.postMessage(config.buildRequest(item));
    }

    for (const w of workers) {
      dispatchNext(w);
    }
  });
}
