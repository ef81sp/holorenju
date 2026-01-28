/**
 * useCpuPlayer Composable Tests
 *
 * Web Workerをモックしてテスト
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";

import type { AIResponse } from "@/types/cpu";
import type { BoardState } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

// Web Workerのモック
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((error: ErrorEvent) => void) | null = null;

  postMessage(_data: unknown): void {
    // 非同期でレスポンスを返す
    setTimeout(() => {
      const response: AIResponse = {
        position: { row: 7, col: 7 },
        score: 100,
        thinkingTime: 50,
        depth: 2,
      };
      if (this.onmessage) {
        this.onmessage({ data: response } as MessageEvent);
      }
    }, 10);
  }

  terminate(): void {
    // No-op for mock
  }
}

// Workerモジュールをモック
vi.mock("@/logic/cpuAI/renjuAI.worker?worker", () => ({
  default: MockWorker,
}));

// onUnmountedをモック（composable外でテストするため）
vi.mock("vue", async () => {
  const actual = await vi.importActual("vue");
  return {
    ...actual,
    onUnmounted: vi.fn(),
  };
});

// useCpuPlayerをモックの後にインポート
const { useCpuPlayer } = await import("./useCpuPlayer");

describe("useCpuPlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("初期状態ではisThinkingはfalse", () => {
    const { isThinking } = useCpuPlayer();
    expect(isThinking.value).toBe(false);
  });

  it("初期状態ではlastResponseはnull", () => {
    const { lastResponse } = useCpuPlayer();
    expect(lastResponse.value).toBeNull();
  });

  it("requestMoveを呼び出すとisThinkingがtrueになる", async () => {
    const { isThinking, requestMove } = useCpuPlayer();
    const board: BoardState = createEmptyBoard();

    const promise = requestMove(board, "black", "beginner");

    // リクエスト直後はthinking中
    expect(isThinking.value).toBe(true);

    // タイマーを進めてレスポンスを受け取る
    await vi.advanceTimersByTimeAsync(20);
    await promise;
    await nextTick();

    // レスポンス後はthinking終了
    expect(isThinking.value).toBe(false);
  });

  it("requestMoveはAIResponseを返す", async () => {
    const { requestMove } = useCpuPlayer();
    const board: BoardState = createEmptyBoard();

    const promise = requestMove(board, "black", "easy");
    await vi.advanceTimersByTimeAsync(20);
    const response = await promise;

    expect(response).toEqual({
      position: { row: 7, col: 7 },
      score: 100,
      thinkingTime: 50,
      depth: 2,
    });
  });

  it("レスポンス後にlastResponseが更新される", async () => {
    const { lastResponse, requestMove } = useCpuPlayer();
    const board: BoardState = createEmptyBoard();

    const promise = requestMove(board, "black", "medium");
    await vi.advanceTimersByTimeAsync(20);
    await promise;

    expect(lastResponse.value).not.toBeNull();
    expect(lastResponse.value?.position).toEqual({ row: 7, col: 7 });
  });

  it("terminateを呼び出すとisThinkingがfalseになる", () => {
    const { isThinking, requestMove, terminate } = useCpuPlayer();
    const board: BoardState = createEmptyBoard();

    // リクエスト開始（Promiseは無視）
    requestMove(board, "black", "hard").catch(() => {
      // Workerが終了されるためエラーになる可能性がある
    });
    expect(isThinking.value).toBe(true);

    // 終了
    terminate();
    expect(isThinking.value).toBe(false);
  });

  it("複数回のrequestMoveを正しく処理する", async () => {
    const { requestMove, lastResponse } = useCpuPlayer();
    const board: BoardState = createEmptyBoard();

    // 1回目
    const promise1 = requestMove(board, "black", "beginner");
    await vi.advanceTimersByTimeAsync(20);
    await promise1;

    expect(lastResponse.value?.depth).toBe(2);

    // 2回目
    const promise2 = requestMove(board, "white", "medium");
    await vi.advanceTimersByTimeAsync(20);
    await promise2;

    expect(lastResponse.value?.depth).toBe(2);
  });
});
