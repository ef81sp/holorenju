/**
 * 汎用ワーカープールディスパッチャーのテスト
 */

import { describe, expect, test, vi } from "vitest";

import { type WorkerLike, runWorkerPool } from "./workerPoolDispatcher";

/** モックワーカー: postMessage 時にレスポンスをキューに溜め、flushで返す */
class MockWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onerror: ((event: ErrorEvent) => unknown) | null = null;
  readonly posted: unknown[] = [];
  private pendingResponses: unknown[] = [];
  private shouldError = false;

  postMessage(data: unknown): void {
    this.posted.push(data);
    // 非同期でレスポンスを返す（マイクロタスクで）
    const response = this.pendingResponses.shift();
    if (this.shouldError) {
      this.shouldError = false;
      Promise.resolve().then(() =>
        this.onerror?.(new Event("error") as ErrorEvent),
      );
    } else {
      Promise.resolve().then(() =>
        this.onmessage?.(
          new MessageEvent("message", { data: response ?? data }),
        ),
      );
    }
  }

  /** 次の postMessage でエラーを返すように設定 */
  setNextError(): void {
    this.shouldError = true;
  }

  /** 次のレスポンスデータを設定 */
  queueResponse(data: unknown): void {
    this.pendingResponses.push(data);
  }
}

describe("runWorkerPool", () => {
  test("空キューで即 resolve", async () => {
    const worker = new MockWorker();
    await runWorkerPool([worker], [], {
      buildRequest: (item) => item,
      handleResult: () => undefined,
    });
    expect(worker.posted).toHaveLength(0);
  });

  test("1ワーカー、複数タスクを逐次処理", async () => {
    const worker = new MockWorker();
    const results: number[] = [];

    const promise = runWorkerPool([worker], [1, 2, 3], {
      buildRequest: (item) => ({ value: item }),
      handleResult: (item) => results.push(item),
    });

    await promise;
    expect(results).toEqual([1, 2, 3]);
    expect(worker.posted).toHaveLength(3);
  });

  test("複数ワーカーで並列ディスパッチ", async () => {
    const w1 = new MockWorker();
    const w2 = new MockWorker();
    const results: number[] = [];

    const promise = runWorkerPool([w1, w2], [1, 2, 3], {
      buildRequest: (item) => item,
      handleResult: (item) => results.push(item),
    });

    await promise;
    // 両ワーカーが使われた
    expect(w1.posted.length + w2.posted.length).toBe(3);
    expect(results).toHaveLength(3);
    expect(results).toContain(1);
    expect(results).toContain(2);
    expect(results).toContain(3);
  });

  test("ワーカーエラーでもカウント継続し完了", async () => {
    const worker = new MockWorker();
    const results: number[] = [];

    // 1番目は正常、2番目でエラー、3番目は正常
    worker.setNextError(); // 1番目でエラー

    const promise = runWorkerPool([worker], [1, 2, 3], {
      buildRequest: (item) => item,
      handleResult: (item) => results.push(item),
    });

    await promise;
    // エラーの1はスキップ、2と3は処理される
    expect(results).not.toContain(1);
    expect(results).toContain(2);
    expect(results).toContain(3);
  });

  test("プログレスコールバックがタスクごとに呼ばれる", async () => {
    const worker = new MockWorker();
    const onProgress = vi.fn();

    await runWorkerPool([worker], [1, 2, 3], {
      buildRequest: (item) => item,
      handleResult: () => undefined,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  test("キャンセルで新規ディスパッチ停止", async () => {
    const worker = new MockWorker();
    let cancelFlag = false;
    const results: number[] = [];

    // 最初のタスク処理後にキャンセル
    const promise = runWorkerPool([worker], [1, 2, 3], {
      buildRequest: (item) => item,
      handleResult: (item) => {
        results.push(item);
        if (item === 1) {
          cancelFlag = true;
        }
      },
      isCancelled: () => cancelFlag,
    });

    await promise;
    // キャンセル後は handleResult が呼ばれない
    expect(results).toEqual([1]);
  });

  test("buildRequest の戻り値が postMessage に渡される", async () => {
    const worker = new MockWorker();

    await runWorkerPool([worker], ["a", "b"], {
      buildRequest: (item) => ({ type: "eval", data: item }),
      handleResult: () => undefined,
    });

    expect(worker.posted[0]).toEqual({ type: "eval", data: "a" });
    expect(worker.posted[1]).toEqual({ type: "eval", data: "b" });
  });

  test("handleResult にアイテムとワーカー結果が渡される", async () => {
    const worker = new MockWorker();
    worker.queueResponse({ score: 100 });
    worker.queueResponse({ score: 200 });

    const calls: [number, unknown][] = [];

    await runWorkerPool<number, { score: number }>([worker], [1, 2], {
      buildRequest: (item) => item,
      handleResult: (item, data) => calls.push([item, data]),
    });

    expect(calls[0]).toEqual([1, { score: 100 }]);
    expect(calls[1]).toEqual([2, { score: 200 }]);
  });
});
