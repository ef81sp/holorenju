import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "./appStore";

// windowオブジェクトのモック
const mockPushState = vi.fn();

vi.stubGlobal("window", {
  history: {
    pushState: mockPushState,
  },
});

describe("appStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockPushState.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("sceneがmenu", () => {
      const store = useAppStore();
      expect(store.scene).toBe("menu");
    });

    it("selectedModeがnull", () => {
      const store = useAppStore();
      expect(store.selectedMode).toBeNull();
    });

    it("selectedDifficultyがnull", () => {
      const store = useAppStore();
      expect(store.selectedDifficulty).toBeNull();
    });

    it("currentPageが0", () => {
      const store = useAppStore();
      expect(store.currentPage).toBe(0);
    });

    it("selectedScenarioIdがnull", () => {
      const store = useAppStore();
      expect(store.selectedScenarioId).toBeNull();
    });
  });

  describe("selectMode", () => {
    it("trainingモードを選択できる", () => {
      const store = useAppStore();
      store.selectMode("training");

      expect(store.selectedMode).toBe("training");
      expect(store.scene).toBe("difficulty");
    });

    it("cpuモードを選択するとcpuSetup画面に遷移する", () => {
      const store = useAppStore();
      store.selectMode("cpu");

      expect(store.selectedMode).toBe("cpu");
      expect(store.scene).toBe("cpuSetup");
    });

    it("transitionDirectionがforwardになる", () => {
      const store = useAppStore();
      store.selectMode("training");

      expect(store.transitionDirection).toBe("forward");
    });

    it("履歴にpushする", () => {
      const store = useAppStore();
      store.selectMode("training");

      expect(mockPushState).toHaveBeenCalled();
    });
  });

  describe("selectDifficulty", () => {
    it("難易度を選択できる", () => {
      const store = useAppStore();
      store.selectMode("training");
      store.selectDifficulty("renju_beginner");

      expect(store.selectedDifficulty).toBe("renju_beginner");
      expect(store.scene).toBe("scenarioList");
    });

    it("モードが選択されていない場合は何もしない", () => {
      const store = useAppStore();
      store.selectDifficulty("renju_beginner");

      expect(store.selectedDifficulty).toBeNull();
      expect(store.scene).toBe("menu");
    });

    it("currentPageを0にリセットする", () => {
      const store = useAppStore();
      store.selectMode("training");
      store.currentPage = 5;
      store.selectDifficulty("renju_beginner");

      expect(store.currentPage).toBe(0);
    });
  });

  describe("selectScenario", () => {
    it("シナリオを選択できる", () => {
      const store = useAppStore();
      store.selectMode("training");
      store.selectDifficulty("renju_beginner");
      store.selectScenario("scenario-1");

      expect(store.selectedScenarioId).toBe("scenario-1");
      expect(store.scene).toBe("scenarioPlay");
    });
  });

  describe("goToMenu", () => {
    it("メニューに戻る", () => {
      const store = useAppStore();
      store.selectMode("training");
      store.selectDifficulty("renju_beginner");

      store.goToMenu();

      expect(store.scene).toBe("menu");
      expect(store.selectedMode).toBeNull();
      expect(store.selectedDifficulty).toBeNull();
      expect(store.selectedScenarioId).toBeNull();
    });

    it("transitionDirectionがbackになる", () => {
      const store = useAppStore();
      store.selectMode("training");
      store.goToMenu();

      expect(store.transitionDirection).toBe("back");
    });
  });

  describe("goToDifficulty", () => {
    it("難易度選択画面に戻る", () => {
      const store = useAppStore();
      store.selectMode("training");
      store.selectDifficulty("renju_beginner");
      store.selectScenario("scenario-1");

      store.goToDifficulty();

      expect(store.scene).toBe("difficulty");
      expect(store.selectedDifficulty).toBeNull();
      expect(store.selectedScenarioId).toBeNull();
    });
  });

  describe("goToScenarioList", () => {
    it("シナリオリストに戻る", () => {
      const store = useAppStore();
      store.selectMode("training");
      store.selectDifficulty("renju_beginner");
      store.selectScenario("scenario-1");

      store.goToScenarioList();

      expect(store.scene).toBe("scenarioList");
      expect(store.selectedScenarioId).toBeNull();
    });

    it("難易度が選択されていない場合は何もしない", () => {
      const store = useAppStore();
      store.goToScenarioList();

      expect(store.scene).toBe("menu");
    });
  });

  describe("CPU対戦機能", () => {
    it("startCpuGameでCPU対戦を開始できる", () => {
      const store = useAppStore();
      store.selectMode("cpu");
      store.startCpuGame("medium", true);

      expect(store.scene).toBe("cpuPlay");
      expect(store.cpuDifficulty).toBe("medium");
      expect(store.cpuPlayerFirst).toBe(true);
    });

    it("goToCpuSetupでCPU設定画面に戻れる", () => {
      const store = useAppStore();
      store.selectMode("cpu");
      store.startCpuGame("hard", false);

      store.goToCpuSetup();

      expect(store.scene).toBe("cpuSetup");
      expect(store.cpuDifficulty).toBeNull();
      expect(store.cpuPlayerFirst).toBeNull();
    });

    it("goToMenuでCPU関連の状態もリセットされる", () => {
      const store = useAppStore();
      store.selectMode("cpu");
      store.startCpuGame("medium", true);

      store.goToMenu();

      expect(store.cpuDifficulty).toBeNull();
      expect(store.cpuPlayerFirst).toBeNull();
    });
  });

  describe("setPage", () => {
    it("ページを設定する", () => {
      const store = useAppStore();
      store.setPage(3);

      expect(store.currentPage).toBe(3);
    });
  });

  describe("restoreState", () => {
    it("部分的な状態を復元できる", () => {
      const store = useAppStore();
      store.restoreState({
        scene: "scenarioList",
        selectedMode: "training",
        selectedDifficulty: "renju_beginner",
      });

      expect(store.scene).toBe("scenarioList");
      expect(store.selectedMode).toBe("training");
      expect(store.selectedDifficulty).toBe("renju_beginner");
    });

    it("transitionDirectionがbackになる", () => {
      const store = useAppStore();
      store.restoreState({ scene: "difficulty" });

      expect(store.transitionDirection).toBe("back");
    });

    it("未指定のプロパティは変更しない", () => {
      const store = useAppStore();
      store.selectMode("training");
      store.selectDifficulty("renju_beginner");

      store.restoreState({ scene: "menu" });

      expect(store.selectedMode).toBe("training"); // 変更されない
    });
  });

  describe("ナビゲーションフロー", () => {
    it("メニュー → 難易度 → シナリオリスト → シナリオプレイ", () => {
      const store = useAppStore();

      // メニュー → 難易度
      store.selectMode("training");
      expect(store.scene).toBe("difficulty");
      expect(store.transitionDirection).toBe("forward");

      // 難易度 → シナリオリスト
      store.selectDifficulty("renju_beginner");
      expect(store.scene).toBe("scenarioList");
      expect(store.transitionDirection).toBe("forward");

      // シナリオリスト → シナリオプレイ
      store.selectScenario("scenario-1");
      expect(store.scene).toBe("scenarioPlay");
      expect(store.transitionDirection).toBe("forward");
    });

    it("シナリオプレイ → シナリオリスト → 難易度 → メニュー（戻る）", () => {
      const store = useAppStore();

      // 前進してシナリオプレイまで
      store.selectMode("training");
      store.selectDifficulty("renju_beginner");
      store.selectScenario("scenario-1");

      // シナリオリストに戻る
      store.goToScenarioList();
      expect(store.scene).toBe("scenarioList");
      expect(store.transitionDirection).toBe("back");

      // 難易度に戻る
      store.goToDifficulty();
      expect(store.scene).toBe("difficulty");
      expect(store.transitionDirection).toBe("back");

      // メニューに戻る
      store.goToMenu();
      expect(store.scene).toBe("menu");
      expect(store.transitionDirection).toBe("back");
    });
  });
});
