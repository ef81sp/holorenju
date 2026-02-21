import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "./appStore";
import { useCpuReviewStore } from "./cpuReviewStore";

// windowオブジェクトのモック
const mockPushState = vi.fn();
const mockReplaceState = vi.fn();

vi.stubGlobal("window", {
  history: {
    pushState: mockPushState,
    replaceState: mockReplaceState,
  },
});

vi.stubGlobal("location", {
  hash: "",
  origin: "http://localhost",
});

describe("appStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockPushState.mockClear();
    mockReplaceState.mockClear();
    location.hash = "";
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

  describe("_buildUrl", () => {
    it("menu → パラメータなし", () => {
      const store = useAppStore();
      expect(store._buildUrl()).toBe("menu");
    });

    it("difficulty → パラメータなし", () => {
      const store = useAppStore();
      store.scene = "difficulty";
      store.selectedMode = "training";
      expect(store._buildUrl()).toBe("difficulty");
    });

    it("scenarioList + gomoku_beginner → d=gb", () => {
      const store = useAppStore();
      store.scene = "scenarioList";
      store.selectedMode = "training";
      store.selectedDifficulty = "gomoku_beginner";
      expect(store._buildUrl()).toBe("scenarioList?d=gb");
    });

    it("scenarioList + gomoku_beginner + page=2 → d=gb&p=2", () => {
      const store = useAppStore();
      store.scene = "scenarioList";
      store.selectedMode = "training";
      store.selectedDifficulty = "gomoku_beginner";
      store.currentPage = 2;
      expect(store._buildUrl()).toBe("scenarioList?d=gb&p=2");
    });

    it("scenarioList + page=0 → pを省略", () => {
      const store = useAppStore();
      store.scene = "scenarioList";
      store.selectedMode = "training";
      store.selectedDifficulty = "gomoku_beginner";
      store.currentPage = 0;
      expect(store._buildUrl()).toBe("scenarioList?d=gb");
    });

    it("scenarioPlay + diff + scenario → d=gb&s=gomoku_beginner_01", () => {
      const store = useAppStore();
      store.scene = "scenarioPlay";
      store.selectedMode = "training";
      store.selectedDifficulty = "gomoku_beginner";
      store.selectedScenarioId = "gomoku_beginner_01";
      expect(store._buildUrl()).toBe("scenarioPlay?d=gb&s=gomoku_beginner_01");
    });

    it("cpuSetup → パラメータなし", () => {
      const store = useAppStore();
      store.scene = "cpuSetup";
      store.selectedMode = "cpu";
      expect(store._buildUrl()).toBe("cpuSetup");
    });

    it("cpuPlay + medium + first=true → cd=m&f=1", () => {
      const store = useAppStore();
      store.scene = "cpuPlay";
      store.selectedMode = "cpu";
      store.cpuDifficulty = "medium";
      store.cpuPlayerFirst = true;
      expect(store._buildUrl()).toBe("cpuPlay?cd=m&f=1");
    });

    it("cpuPlay + hard + first=false → cd=h&f=0", () => {
      const store = useAppStore();
      store.scene = "cpuPlay";
      store.selectedMode = "cpu";
      store.cpuDifficulty = "hard";
      store.cpuPlayerFirst = false;
      expect(store._buildUrl()).toBe("cpuPlay?cd=h&f=0");
    });

    it("cpuReview + 棋譜あり + 黒視点 → g と ps を含む", () => {
      const store = useAppStore();
      const reviewStore = useCpuReviewStore();
      reviewStore.openReviewFromImport("H8 G7 I9", "black");
      store.scene = "cpuReview";
      store.selectedMode = "cpu";
      expect(store._buildUrl()).toBe("cpuReview?g=H8.G7.I9&ps=b");
    });

    it("cpuReview + 棋譜あり + recordId → g, ps, r を含む", () => {
      const store = useAppStore();
      const reviewStore = useCpuReviewStore();
      reviewStore.openReviewFromImport("H8 G7", "white");
      store.scene = "cpuReview";
      store.selectedMode = "cpu";
      store.reviewRecordId = "abc123";
      expect(store._buildUrl()).toBe("cpuReview?g=H8.G7&ps=w&r=abc123");
    });

    it("cpuReview + 棋譜なし + recordId → r のみ", () => {
      const store = useAppStore();
      store.scene = "cpuReview";
      store.selectedMode = "cpu";
      store.reviewRecordId = "abc123";
      expect(store._buildUrl()).toBe("cpuReview?r=abc123");
    });

    it("cpuReview + 棋譜なし → パラメータなし", () => {
      const store = useAppStore();
      store.scene = "cpuReview";
      store.selectedMode = "cpu";
      expect(store._buildUrl()).toBe("cpuReview");
    });

    it("全難易度の略称マッピング", () => {
      const store = useAppStore();
      store.scene = "scenarioList";
      store.selectedMode = "training";

      const cases: [string, string][] = [
        ["gomoku_beginner", "gb"],
        ["gomoku_intermediate", "gi"],
        ["renju_beginner", "rb"],
        ["renju_intermediate", "ri"],
        ["renju_advanced", "ra"],
        ["renju_expert", "re"],
      ];

      for (const [difficulty, abbr] of cases) {
        store.selectedDifficulty =
          difficulty as typeof store.selectedDifficulty;
        expect(store._buildUrl()).toBe(`scenarioList?d=${abbr}`);
      }
    });

    it("全CPU難易度の略称マッピング", () => {
      const store = useAppStore();
      store.scene = "cpuPlay";
      store.selectedMode = "cpu";
      store.cpuPlayerFirst = true;

      const cases: [string, string][] = [
        ["beginner", "b"],
        ["easy", "e"],
        ["medium", "m"],
        ["hard", "h"],
      ];

      for (const [difficulty, abbr] of cases) {
        store.cpuDifficulty = difficulty as typeof store.cpuDifficulty;
        expect(store._buildUrl()).toBe(`cpuPlay?cd=${abbr}&f=1`);
      }
    });
  });

  describe("tryRestoreFromBrowser（URLクエリパラメータ）", () => {
    it("#scenarioList?d=rb → scene=scenarioList, mode=training, diff=renju_beginner", () => {
      location.hash = "#scenarioList?d=rb";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.scene).toBe("scenarioList");
      expect(store.selectedMode).toBe("training");
      expect(store.selectedDifficulty).toBe("renju_beginner");
    });

    it("#scenarioList?d=ri&p=2 → page=2", () => {
      location.hash = "#scenarioList?d=ri&p=2";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.currentPage).toBe(2);
      expect(store.selectedDifficulty).toBe("renju_intermediate");
    });

    it("#scenarioList?d=gb → page=0（p省略時デフォルト）", () => {
      location.hash = "#scenarioList?d=gb";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.currentPage).toBe(0);
    });

    it("#cpuPlay?cd=h&f=0 → cpuSetupにフォールバック", () => {
      location.hash = "#cpuPlay?cd=h&f=0";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.scene).toBe("cpuSetup");
      expect(store.selectedMode).toBe("cpu");
    });

    it("#scenarioPlay?d=gb&s=xxx → scenarioListにフォールバック", () => {
      location.hash = "#scenarioPlay?d=gb&s=xxx";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.scene).toBe("scenarioList");
      expect(store.selectedDifficulty).toBe("gomoku_beginner");
    });

    it("#cpuReview?r=abc → cpuSetupにフォールバック", () => {
      location.hash = "#cpuReview?r=abc";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.scene).toBe("cpuSetup");
      expect(store.selectedMode).toBe("cpu");
    });

    it("#difficulty → mode=training", () => {
      location.hash = "#difficulty";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.scene).toBe("difficulty");
      expect(store.selectedMode).toBe("training");
    });

    it("#cpuSetup → mode=cpu", () => {
      location.hash = "#cpuSetup";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.scene).toBe("cpuSetup");
      expect(store.selectedMode).toBe("cpu");
    });

    it("#menu → false（デフォルトと同じ）", () => {
      location.hash = "#menu";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(false);
    });

    it("不正なシーン → false", () => {
      location.hash = "#invalid";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(false);
    });

    it("#scenarioList（dなし） → difficultyにフォールバック", () => {
      location.hash = "#scenarioList";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.scene).toBe("difficulty");
      expect(store.selectedMode).toBe("training");
    });
  });

  describe("tryRestoreFromBrowser（棋譜共有URL）", () => {
    it("#cpuReview?g=H8.G7.I9&ps=b → reviewImported=true, 棋譜復元", () => {
      location.hash = "#cpuReview?g=H8.G7.I9&ps=b";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.scene).toBe("cpuReview");
      expect(store.reviewImported).toBe(true);
      expect(store.selectedMode).toBe("cpu");

      const reviewStore = useCpuReviewStore();
      expect(reviewStore.reviewSource?.type).toBe("imported");
      if (reviewStore.reviewSource?.type === "imported") {
        expect(reviewStore.reviewSource.moveHistory).toBe("H8 G7 I9");
        expect(reviewStore.reviewSource.playerSide).toBe("black");
      }
    });

    it("#cpuReview?g=H8.G7&ps=a → playerSide=both", () => {
      location.hash = "#cpuReview?g=H8.G7&ps=a";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);

      const reviewStore = useCpuReviewStore();
      if (reviewStore.reviewSource?.type === "imported") {
        expect(reviewStore.reviewSource.playerSide).toBe("both");
      }
    });

    it("#cpuReview?g=H8.G7 → ps省略時=both", () => {
      location.hash = "#cpuReview?g=H8.G7";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);

      const reviewStore = useCpuReviewStore();
      if (reviewStore.reviewSource?.type === "imported") {
        expect(reviewStore.reviewSource.playerSide).toBe("both");
      }
    });

    it("r と g 同時 → g を優先", () => {
      location.hash = "#cpuReview?r=abc123&g=H8.G7.I9&ps=w";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.scene).toBe("cpuReview");
      expect(store.reviewImported).toBe(true);
      expect(store.reviewRecordId).toBeNull();

      const reviewStore = useCpuReviewStore();
      if (reviewStore.reviewSource?.type === "imported") {
        expect(reviewStore.reviewSource.playerSide).toBe("white");
      }
    });

    it("#cpuReview（g も r もなし） → cpuSetupにフォールバック", () => {
      location.hash = "#cpuReview";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.scene).toBe("cpuSetup");
    });

    it("不正な棋譜 → cpuSetupにフォールバック", () => {
      location.hash = "#cpuReview?g=ZZ.99";
      const store = useAppStore();
      expect(store.tryRestoreFromBrowser()).toBe(true);
      expect(store.scene).toBe("cpuSetup");
    });
  });

  describe("pushHistory がURLにパラメータを含める", () => {
    it("selectDifficulty後のURLに d パラメータが含まれる", () => {
      const store = useAppStore();
      store.selectMode("training");
      store.selectDifficulty("renju_beginner");

      const lastCall =
        mockPushState.mock.calls[mockPushState.mock.calls.length - 1];
      expect(lastCall?.[2]).toBe("#scenarioList?d=rb");
    });

    it("setPage後のURLに p パラメータが含まれる", () => {
      const store = useAppStore();
      store.selectMode("training");
      store.selectDifficulty("renju_beginner");
      store.setPage(2);

      const lastCall =
        mockPushState.mock.calls[mockPushState.mock.calls.length - 1];
      expect(lastCall?.[2]).toBe("#scenarioList?d=rb&p=2");
    });

    it("selectScenario後のURLに s パラメータが含まれる", () => {
      const store = useAppStore();
      store.selectMode("training");
      store.selectDifficulty("gomoku_beginner");
      store.selectScenario("gomoku_beginner_01");

      const lastCall =
        mockPushState.mock.calls[mockPushState.mock.calls.length - 1];
      expect(lastCall?.[2]).toBe("#scenarioPlay?d=gb&s=gomoku_beginner_01");
    });

    it("startCpuGame後のURLに cd, f パラメータが含まれる", () => {
      const store = useAppStore();
      store.selectMode("cpu");
      store.startCpuGame("medium", true);

      const lastCall =
        mockPushState.mock.calls[mockPushState.mock.calls.length - 1];
      expect(lastCall?.[2]).toBe("#cpuPlay?cd=m&f=1");
    });

    it("openCpuReview後のURLに g, ps, r パラメータが含まれる", () => {
      const store = useAppStore();
      const reviewStore = useCpuReviewStore();
      // CPU対戦記録をセットアップ（実際のフローではopenReviewが先に呼ばれる）
      reviewStore.openReviewFromImport("H8 G7 I9", "black");
      store.selectMode("cpu");
      store.openCpuReview("record123");

      const lastCall =
        mockPushState.mock.calls[mockPushState.mock.calls.length - 1];
      expect(lastCall?.[2]).toBe("#cpuReview?g=H8.G7.I9&ps=b&r=record123");
    });

    it("goToMenu後のURLはパラメータなし", () => {
      const store = useAppStore();
      store.selectMode("training");
      store.goToMenu();

      const lastCall =
        mockPushState.mock.calls[mockPushState.mock.calls.length - 1];
      expect(lastCall?.[2]).toBe("#menu");
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
