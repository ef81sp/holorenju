import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProgressStore } from "./progressStore";

describe("progressStore", () => {
  // localStorageのモック
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    };
  })();

  beforeEach(() => {
    vi.stubGlobal("localStorage", localStorageMock);
    localStorageMock.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("初期状態", () => {
    it("空のcompletedScenarios", () => {
      const store = useProgressStore();
      expect(store.completedScenarios).toEqual([]);
    });

    it("currentScenarioがnull", () => {
      const store = useProgressStore();
      expect(store.currentScenario).toBeNull();
    });

    it("totalScoreが0", () => {
      const store = useProgressStore();
      expect(store.totalScore).toBe(0);
    });

    it("空のachievements", () => {
      const store = useProgressStore();
      expect(store.achievements).toEqual([]);
    });
  });

  describe("startScenario", () => {
    it("currentScenarioを設定する", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      expect(store.currentScenario).toBe("scenario-1");
    });

    it("新しいシナリオの進度を初期化する", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress).not.toBeNull();
      expect(progress?.scenarioId).toBe("scenario-1");
      expect(progress?.completedSections).toEqual([]);
      expect(progress?.currentSectionIndex).toBe(0);
      expect(progress?.isCompleted).toBe(false);
      expect(progress?.score).toBe(0);
    });

    it("既存の進度は上書きしない", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "section-1", 100);

      store.startScenario("scenario-1"); // 再度開始

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.score).toBe(100);
      expect(progress?.completedSections).toContain("section-1");
    });
  });

  describe("completeSection", () => {
    it("セクションを完了済みに追加する", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "section-1", 50);

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.completedSections).toContain("section-1");
    });

    it("スコアを加算する", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "section-1", 50);

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.score).toBe(50);
      expect(store.totalScore).toBe(50);
    });

    it("同じセクションは二重加算されない", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "section-1", 50);
      store.completeSection("scenario-1", "section-1", 50);

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.score).toBe(50);
      expect(store.totalScore).toBe(50);
    });

    it("localStorageに保存する", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "section-1", 50);

      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  describe("completeScenario", () => {
    it("シナリオを完了済みに追加する", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeScenario("scenario-1");

      expect(store.completedScenarios).toContain("scenario-1");
    });

    it("進度のisCompletedをtrueにする", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeScenario("scenario-1");

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.isCompleted).toBe(true);
    });

    it("currentScenarioをnullにする", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeScenario("scenario-1");

      expect(store.currentScenario).toBeNull();
    });

    it("同じシナリオは二重追加されない", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeScenario("scenario-1");
      store.startScenario("scenario-1");
      store.completeScenario("scenario-1");

      expect(
        store.completedScenarios.filter((s) => s === "scenario-1"),
      ).toHaveLength(1);
    });
  });

  describe("addAchievement", () => {
    it("実績を追加する", () => {
      const store = useProgressStore();
      store.addAchievement("first-win");

      expect(store.achievements).toContain("first-win");
    });

    it("同じ実績は二重追加されない", () => {
      const store = useProgressStore();
      store.addAchievement("first-win");
      store.addAchievement("first-win");

      expect(store.achievements.filter((a) => a === "first-win")).toHaveLength(
        1,
      );
    });
  });

  describe("completionRate", () => {
    it("完了率を計算する", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeScenario("scenario-1");

      // totalScenarios = 3なので、1/3 * 100 ≈ 33.33...
      expect(store.completionRate).toBeCloseTo(33.33, 1);
    });

    it("シナリオがない場合は0", () => {
      const store = useProgressStore();
      expect(store.completionRate).toBe(0);
    });
  });

  describe("saveProgress / loadProgress", () => {
    it("localStorageに保存できる", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "section-1", 100);
      store.addAchievement("first-win");

      store.saveProgress();

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "holorenju_progress",
        expect.any(String),
      );
    });

    it("localStorageから読み込める", () => {
      // 事前にデータを設定
      const savedData = {
        completedScenarios: ["scenario-1"],
        currentScenario: null as string | null,
        totalScore: 100,
        achievements: ["first-win"],
        lastPlayedAt: new Date().toISOString(),
        scenarioProgress: [
          [
            "scenario-1",
            {
              scenarioId: "scenario-1",
              completedSections: ["section-1"],
              currentSectionIndex: 1,
              isCompleted: true,
              score: 100,
            },
          ],
        ],
      };
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(savedData));

      setActivePinia(createPinia());
      const store = useProgressStore();

      expect(store.completedScenarios).toEqual(["scenario-1"]);
      expect(store.totalScore).toBe(100);
      expect(store.achievements).toContain("first-win");
    });

    it("不正なJSONでもクラッシュしない", () => {
      localStorageMock.getItem.mockReturnValueOnce("invalid json");

      setActivePinia(createPinia());
      const store = useProgressStore();

      // デフォルト値が使われる
      expect(store.completedScenarios).toEqual([]);
    });
  });

  describe("resetProgress", () => {
    it("全ての進度をリセットする", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "section-1", 100);
      store.completeScenario("scenario-1");
      store.addAchievement("first-win");

      store.resetProgress();

      expect(store.completedScenarios).toEqual([]);
      expect(store.currentScenario).toBeNull();
      expect(store.totalScore).toBe(0);
      expect(store.achievements).toEqual([]);
    });

    it("localStorageからも削除する", () => {
      const store = useProgressStore();
      store.resetProgress();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(
        "holorenju_progress",
      );
    });
  });

  describe("getScenarioProgress", () => {
    it("存在するシナリオの進度を返す", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress).not.toBeNull();
      expect(progress?.scenarioId).toBe("scenario-1");
    });

    it("存在しないシナリオはnullを返す", () => {
      const store = useProgressStore();

      const progress = store.getScenarioProgress("nonexistent");
      expect(progress).toBeNull();
    });
  });
});
