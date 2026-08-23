/**
 * 汎用ワーカープールディスパッチャーのテスト
 */

import { afterEach, describe, expect, test, vi } from "vitest";

import { type WorkerLike, runWorkerPool } from "./workerPoolDispatcher";

/** モックワーカー: postMessage 時にレスポンスをキューに溜め、flushで返す */
class MockWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onerror: ((event: ErrorEvent) => unknown) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;
  private pendingResponses: unknown[] = [];
  private shouldError = false;
  /** true 中は postMessage しても応答を返さない（Worker が死んだ想定） */
  private hang = false;

  postMessage(data: unknown): void {
    this.posted.push(data);
    if (this.hang) {
      return;
    }
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

  terminate(): void {
    this.terminated = true;
  }

  /** 次の postMessage でエラーを返すように設定 */
  setNextError(): void {
    this.shouldError = true;
  }

  /** 次のレスポンスデータを設定 */
  queueResponse(data: unknown): void {
    this.pendingResponses.push(data);
  }

  /** postMessage しても応答を返さないモードに切り替え */
  setHang(hang: boolean): void {
    this.hang = hang;
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

  describe("watchdog", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    test("timeoutMs 超過で worker を terminate し新規 worker で再投入", async () => {
      vi.useFakeTimers();
      const w1 = new MockWorker();
      const w2 = new MockWorker();
      const created: MockWorker[] = [];
      let createdIndex = 0;

      w1.setHang(true); // 応答しない = 死亡想定
      const results: number[] = [];

      const promise = runWorkerPool([w1], [1, 2], {
        buildRequest: (item) => item,
        handleResult: (item) => results.push(item),
        timeoutMs: 20000,
        maxRetries: 1,
        createWorker: () => {
          const w = createdIndex === 0 ? w2 : new MockWorker();
          createdIndex++;
          created.push(w);
          return w;
        },
      });

      await Promise.resolve(); // postMessage 発火まで待つ
      expect(w1.posted).toEqual([1]);

      // タイムアウトを進める
      await vi.advanceTimersByTimeAsync(20000);
      expect(w1.terminated).toBe(true);
      expect(created).toHaveLength(1);

      // w2 で再試行 → 1 が成功、続けて 2 も処理される
      await vi.runAllTimersAsync();
      await promise;

      expect(results).toEqual([1, 2]);
      expect(w2.posted).toEqual([1, 2]);
    });

    test("maxRetries 回まで再試行、超過したら onTaskFailed で報告", async () => {
      vi.useFakeTimers();
      const workers: MockWorker[] = [];
      const makeHangWorker = (): MockWorker => {
        const w = new MockWorker();
        w.setHang(true);
        workers.push(w);
        return w;
      };

      const initial = makeHangWorker();
      const failed: number[] = [];

      const promise = runWorkerPool([initial], [1, 2], {
        buildRequest: (item) => item,
        handleResult: () => undefined,
        timeoutMs: 20000,
        maxRetries: 1,
        createWorker: makeHangWorker,
        onTaskFailed: (item) => failed.push(item),
      });

      // 1回目のタイムアウト → 再試行
      await vi.advanceTimersByTimeAsync(20000);
      // 2回目のタイムアウト → 失敗確定
      await vi.advanceTimersByTimeAsync(20000);
      // 3回目のタスクも同様に失敗させる
      await vi.advanceTimersByTimeAsync(20000);
      await vi.advanceTimersByTimeAsync(20000);
      await vi.runAllTimersAsync();
      await promise;

      expect(failed).toEqual([1, 2]);
      expect(initial.terminated).toBe(true);
    });

    test("失敗タスクでも onProgress は前進する", async () => {
      vi.useFakeTimers();
      const workers: MockWorker[] = [];
      const makeHang = (): MockWorker => {
        const w = new MockWorker();
        w.setHang(true);
        workers.push(w);
        return w;
      };
      const initial = makeHang();
      const onProgress = vi.fn();

      const promise = runWorkerPool([initial], [1], {
        buildRequest: (item) => item,
        handleResult: () => undefined,
        onProgress,
        timeoutMs: 20000,
        maxRetries: 0,
        createWorker: makeHang,
      });

      await vi.advanceTimersByTimeAsync(20000);
      await vi.runAllTimersAsync();
      await promise;

      expect(onProgress).toHaveBeenCalledTimes(1);
    });

    test("timeoutMs 未設定なら watchdog は動かず既存挙動", async () => {
      const w = new MockWorker();
      const results: number[] = [];
      await runWorkerPool([w], [1, 2], {
        buildRequest: (item) => item,
        handleResult: (item) => results.push(item),
      });
      expect(results).toEqual([1, 2]);
      expect(w.terminated).toBe(false);
    });

    test("正常応答は timer をクリアしタスク継続", async () => {
      vi.useFakeTimers();
      const w = new MockWorker();
      const results: number[] = [];

      const promise = runWorkerPool([w], [1, 2, 3], {
        buildRequest: (item) => item,
        handleResult: (item) => results.push(item),
        timeoutMs: 20000,
        maxRetries: 1,
        createWorker: () => new MockWorker(),
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(results).toEqual([1, 2, 3]);
      expect(w.terminated).toBe(false);
    });

    test("cancel 直後の timeout 発火では新規 Worker を作らない", async () => {
      vi.useFakeTimers();
      const w = new MockWorker();
      w.setHang(true);
      let cancelFlag = false;
      let createCount = 0;

      const promise = runWorkerPool([w], [1], {
        buildRequest: (item) => item,
        handleResult: () => undefined,
        isCancelled: () => cancelFlag,
        timeoutMs: 20000,
        maxRetries: 1,
        createWorker: () => {
          createCount++;
          return new MockWorker();
        },
      });

      // タイムアウト直前で cancel
      await vi.advanceTimersByTimeAsync(19999);
      cancelFlag = true;
      // タイムアウト発火
      await vi.advanceTimersByTimeAsync(2);
      await vi.runAllTimersAsync();
      await promise;

      expect(w.terminated).toBe(true);
      // cancel 済みなので replacement Worker は作らない
      expect(createCount).toBe(0);
    });

    test("timeoutMs 指定で createWorker 未指定なら throw", () => {
      const w = new MockWorker();
      expect(() =>
        runWorkerPool([w], [1], {
          buildRequest: (item) => item,
          handleResult: () => undefined,
          timeoutMs: 20000,
        }),
      ).toThrow(/createWorker/);
    });
  });
});
