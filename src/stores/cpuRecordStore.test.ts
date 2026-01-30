/**
 * cpuRecordStore テスト
 */

import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCpuRecordStore } from "./cpuRecordStore";

// localStorageのモック
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

describe("cpuRecordStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("記録は空", () => {
      const store = useCpuRecordStore();
      expect(store.records).toHaveLength(0);
    });

    it("localStorageから記録を読み込む", () => {
      const existingRecords = [
        {
          id: "record-1",
          timestamp: Date.now(),
          difficulty: "medium",
          playerFirst: true,
          result: "win",
          moves: 42,
        },
      ];
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify(existingRecords),
      );

      const store = useCpuRecordStore();

      expect(store.records).toHaveLength(1);
      expect(store.records[0]?.id).toBe("record-1");
    });
  });

  describe("addRecord", () => {
    it("記録を追加できる", () => {
      const store = useCpuRecordStore();

      store.addRecord("medium", true, "win", 42);

      expect(store.records).toHaveLength(1);
      expect(store.records[0]?.difficulty).toBe("medium");
      expect(store.records[0]?.result).toBe("win");
      expect(store.records[0]?.moves).toBe(42);
    });

    it("記録は最新が先頭に追加される", () => {
      const store = useCpuRecordStore();

      store.addRecord("medium", true, "win", 42);
      store.addRecord("hard", false, "lose", 30);

      expect(store.records[0]?.difficulty).toBe("hard");
      expect(store.records[1]?.difficulty).toBe("medium");
    });

    it("100件を超えると古い記録が削除される", () => {
      const store = useCpuRecordStore();

      for (let i = 0; i < 105; i++) {
        store.addRecord("medium", true, "win", i);
      }

      expect(store.records).toHaveLength(100);
    });

    it("localStorageに保存される", async () => {
      const store = useCpuRecordStore();

      store.addRecord("medium", true, "win", 42);

      // watchは非同期で実行されるため、次のティックを待つ
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  describe("getStatsByDifficulty", () => {
    it("難易度別の統計を取得できる", () => {
      const store = useCpuRecordStore();

      store.addRecord("medium", true, "win", 42);
      store.addRecord("medium", true, "win", 38);
      store.addRecord("medium", true, "lose", 45);

      const stats = store.getStatsByDifficulty("medium");

      expect(stats.difficulty).toBe("medium");
      expect(stats.wins).toBe(2);
      expect(stats.losses).toBe(1);
      expect(stats.totalGames).toBe(3);
      expect(stats.winRate).toBeCloseTo(2 / 3, 2);
    });

    it("記録がない場合は0", () => {
      const store = useCpuRecordStore();

      const stats = store.getStatsByDifficulty("hard");

      expect(stats.wins).toBe(0);
      expect(stats.losses).toBe(0);
      expect(stats.totalGames).toBe(0);
      expect(stats.winRate).toBe(0);
    });
  });

  describe("recentRecords", () => {
    it("直近10件の記録を取得できる", () => {
      const store = useCpuRecordStore();

      for (let i = 0; i < 15; i++) {
        store.addRecord("medium", true, "win", i);
      }

      expect(store.recentRecords).toHaveLength(10);
    });

    it("記録が10件未満の場合はすべて返す", () => {
      const store = useCpuRecordStore();

      for (let i = 0; i < 5; i++) {
        store.addRecord("medium", true, "win", i);
      }

      expect(store.recentRecords).toHaveLength(5);
    });
  });

  describe("allStats", () => {
    it("全難易度の統計を取得できる", () => {
      const store = useCpuRecordStore();

      store.addRecord("beginner", true, "win", 30);
      store.addRecord("easy", true, "lose", 25);
      store.addRecord("medium", true, "win", 40);
      store.addRecord("hard", true, "draw", 50);

      const stats = store.allStats;

      expect(stats).toHaveLength(4);
      expect(stats.find((s) => s.difficulty === "beginner")?.wins).toBe(1);
      expect(stats.find((s) => s.difficulty === "easy")?.losses).toBe(1);
      expect(stats.find((s) => s.difficulty === "medium")?.wins).toBe(1);
      expect(stats.find((s) => s.difficulty === "hard")?.draws).toBe(1);
    });
  });

  describe("clearRecords", () => {
    it("記録をクリアできる", () => {
      const store = useCpuRecordStore();

      store.addRecord("medium", true, "win", 42);
      expect(store.records).toHaveLength(1);

      store.clearRecords();

      expect(store.records).toHaveLength(0);
    });
  });
});
