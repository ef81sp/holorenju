/**
 * cpuReviewStore テスト
 *
 * forcedLoss チェーン集計（accuracy/criticalErrors から forcedReply を
 * 除外する挙動）を中心に検証する。
 */

import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EvaluatedMove } from "@/types/review";

import { useCpuReviewStore } from "./cpuReviewStore";

// localStorageのモック（reviewCacheが読み書きするため）
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      const { [key]: _, ...rest } = store;
      store = rest;
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

function makeMove(
  moveIndex: number,
  opts?: {
    isPlayerMove?: boolean;
    quality?: EvaluatedMove["quality"];
    forcedLossType?: EvaluatedMove["forcedLossType"];
  },
): EvaluatedMove {
  return {
    moveIndex,
    position: { row: 0, col: 0 },
    isPlayerMove: opts?.isPlayerMove ?? true,
    quality: opts?.quality ?? "excellent",
    playedScore: 0,
    bestScore: 0,
    scoreDiff: 0,
    bestMove: { row: 0, col: 0 },
    candidates: [],
    forcedLossType: opts?.forcedLossType,
  };
}

describe("cpuReviewStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("評価済みの手がなければ精度はnull", () => {
      const store = useCpuReviewStore();
      expect(store.playerAccuracy).toBeNull();
    });

    it("評価済みの手がなければミス数は0", () => {
      const store = useCpuReviewStore();
      expect(store.criticalErrors).toBe(0);
    });
  });

  describe("forcedLossチェーン集計", () => {
    it("チェーン2手目以降はcriticalErrorsに含まれない", () => {
      const store = useCpuReviewStore();
      store.evaluatedMoves = [
        makeMove(3, { quality: "blunder", forcedLossType: "vct" }), // 敗着
        makeMove(4, { isPlayerMove: false }),
        makeMove(5, { quality: "mistake", forcedLossType: "vcf" }), // 強制応手
        makeMove(6, { isPlayerMove: false }),
        makeMove(7, { quality: "blunder", forcedLossType: "vct" }), // 強制応手
      ];

      expect(store.criticalErrors).toBe(1);
    });

    it("forcedReplyはaccuracyの分母から除外される", () => {
      const store = useCpuReviewStore();
      store.evaluatedMoves = [
        makeMove(3, { quality: "blunder", forcedLossType: "vct" }),
        makeMove(4, { isPlayerMove: false }),
        makeMove(5, { quality: "mistake", forcedLossType: "vcf" }),
      ];

      // 分母は3手目のみ(1件)。blunderなのでgoodOrBetter=0 → 0%
      expect(store.playerAccuracy).toBe(0);
    });

    it("evaluatedMovesWithChainsでチェーン継続手がforcedReplyに再分類される", () => {
      const store = useCpuReviewStore();
      store.evaluatedMoves = [
        makeMove(3, { quality: "blunder", forcedLossType: "vct" }),
        makeMove(4, { isPlayerMove: false }),
        makeMove(5, { quality: "mistake", forcedLossType: "vcf" }),
      ];

      const chained = store.evaluatedMovesWithChains;
      expect(chained.find((m) => m.moveIndex === 3)?.quality).toBe("blunder");
      expect(chained.find((m) => m.moveIndex === 5)?.quality).toBe(
        "forcedReply",
      );
    });

    it("生のevaluatedMovesは再分類されない（逐次追加・部分更新用の生データを維持）", () => {
      const store = useCpuReviewStore();
      store.evaluatedMoves = [
        makeMove(3, { quality: "blunder", forcedLossType: "vct" }),
        makeMove(4, { isPlayerMove: false }),
        makeMove(5, { quality: "mistake", forcedLossType: "vcf" }),
      ];

      expect(store.evaluatedMoves.find((m) => m.moveIndex === 5)?.quality).toBe(
        "mistake",
      );
    });

    it("currentEvaluationはforcedReply再分類済みの値を返す", () => {
      const store = useCpuReviewStore();
      store.evaluatedMoves = [
        makeMove(3, { quality: "blunder", forcedLossType: "vct" }),
        makeMove(4, { isPlayerMove: false }),
        makeMove(5, { quality: "mistake", forcedLossType: "vcf" }),
      ];
      store.currentMoveIndex = 6; // moveIndex 5 (0始まり) を指す

      expect(store.currentEvaluation?.quality).toBe("forcedReply");
    });

    it("独立した2チェーンはそれぞれ敗着としてcriticalErrorsに含まれる", () => {
      const store = useCpuReviewStore();
      store.evaluatedMoves = [
        makeMove(3, { quality: "blunder", forcedLossType: "vct" }), // 敗着1
        makeMove(4, { isPlayerMove: false }),
        makeMove(5, { quality: "excellent" }), // 脱出
        makeMove(6, { isPlayerMove: false }),
        makeMove(7, { quality: "blunder", forcedLossType: "vcf" }), // 敗着2
      ];

      expect(store.criticalErrors).toBe(2);
    });
  });
});
