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
        Reflect.deleteProperty(store, key);
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
    });

    it("既存の進度は上書きしない", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "section-1");

      store.startScenario("scenario-1"); // 再度開始

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.completedSections).toContain("section-1");
    });
  });

  describe("completeSection", () => {
    it("セクションを完了済みに追加する", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "section-1");

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.completedSections).toContain("section-1");
    });

    it("同じセクションは二重追加されない", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "section-1");
      store.completeSection("scenario-1", "section-1");

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.completedSections).toHaveLength(1);
    });

    it("localStorageに保存する", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "section-1");

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
      store.completeSection("scenario-1", "section-1");
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
            },
          ],
        ],
      };
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(savedData));

      setActivePinia(createPinia());
      const store = useProgressStore();

      expect(store.completedScenarios).toEqual(["scenario-1"]);
      expect(store.achievements).toContain("first-win");
    });

    it("既存データのscore/totalScoreフィールドを無視する", () => {
      const savedData = {
        completedScenarios: ["scenario-1"],
        currentScenario: null as string | null,
        totalScore: 999,
        achievements: [] as string[],
        lastPlayedAt: new Date().toISOString(),
        scenarioProgress: [
          [
            "scenario-1",
            {
              scenarioId: "scenario-1",
              completedSections: ["section-1"],
              currentSectionIndex: 1,
              isCompleted: true,
              score: 999,
            },
          ],
        ],
      };
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(savedData));

      setActivePinia(createPinia());
      const store = useProgressStore();

      expect(store.completedScenarios).toEqual(["scenario-1"]);
      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.completedSections).toEqual(["section-1"]);
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
      store.completeSection("scenario-1", "section-1");
      store.completeScenario("scenario-1");
      store.addAchievement("first-win");

      store.resetProgress();

      expect(store.completedScenarios).toEqual([]);
      expect(store.currentScenario).toBeNull();
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

  describe("reconcileProgress", () => {
    it("進行度がなければ何もしない", () => {
      const store = useProgressStore();
      store.reconcileProgress("scenario-1", "hash1", ["s1"], ["s1"]);
      expect(store.getScenarioProgress("scenario-1")).toBeNull();
    });

    it("ハッシュが一致すれば何もしない", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "s1");

      // ハッシュを設定
      store.reconcileProgress("scenario-1", "hash1", ["s1", "s2"], ["s1"]);

      // 同じハッシュで再度呼び出し → 変更なし
      store.reconcileProgress("scenario-1", "hash1", ["s1"], ["s1"]);

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.completedSections).toContain("s1");
    });

    it("ハッシュ未設定（既存ユーザー）ならreconcileを実行する", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "s1");

      // structureHash が undefined の状態で呼び出す
      store.reconcileProgress("scenario-1", "hash1", ["s1", "s2"], ["s1"]);

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.structureHash).toBe("hash1");
    });

    it("存続セクションのcompletedSectionsは保持される", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "s1");
      store.completeSection("scenario-1", "s2");

      // s3追加、s1とs2は残る
      store.reconcileProgress(
        "scenario-1",
        "hash2",
        ["s1", "s2", "s3"],
        ["s1", "s2"],
      );

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.completedSections).toContain("s1");
      expect(progress?.completedSections).toContain("s2");
    });

    it("孤立セクションのcompletedSectionsは除去される", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "s1");
      store.completeSection("scenario-1", "s2");
      store.completeSection("scenario-1", "s3");

      // s2が削除された
      store.reconcileProgress("scenario-1", "hash2", ["s1", "s3"], ["s1"]);

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.completedSections).toContain("s1");
      expect(progress?.completedSections).toContain("s3");
      expect(progress?.completedSections).not.toContain("s2");
    });

    it("currentSectionIndexをセクション数内にクランプする", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");

      // currentSectionIndexを手動で大きな値に設定
      const progress = store.getScenarioProgress("scenario-1");
      if (progress) {
        progress.currentSectionIndex = 5;
      }

      // 2セクションしかないシナリオにreconcile
      store.reconcileProgress("scenario-1", "hash2", ["s1", "s2"], ["s1"]);

      const updated = store.getScenarioProgress("scenario-1");
      expect(updated?.currentSectionIndex).toBeLessThanOrEqual(1);
    });

    it("isCompletedがfalseに変わるケース", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "q1");
      store.completeScenario("scenario-1");

      expect(store.getScenarioProgress("scenario-1")?.isCompleted).toBe(true);
      expect(store.completedScenarios).toContain("scenario-1");

      // 新しいquestionセクションq2を追加
      store.reconcileProgress(
        "scenario-1",
        "hash2",
        ["q1", "q2"],
        ["q1", "q2"],
      );

      const progress = store.getScenarioProgress("scenario-1");
      expect(progress?.isCompleted).toBe(false);
    });

    it("completedScenariosからも除去される", () => {
      const store = useProgressStore();
      store.startScenario("scenario-1");
      store.completeSection("scenario-1", "q1");
      store.completeScenario("scenario-1");

      expect(store.completedScenarios).toContain("scenario-1");

      // 新しいquestionセクションq2を追加
      store.reconcileProgress(
        "scenario-1",
        "hash2",
        ["q1", "q2"],
        ["q1", "q2"],
      );

      expect(store.completedScenarios).not.toContain("scenario-1");
    });
  });
});
