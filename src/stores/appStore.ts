/// <reference types="navigation-api-types" />
import { defineStore } from "pinia";

import type { CpuDifficulty } from "@/types/cpu";
import type { ScenarioDifficulty } from "@/types/scenario";

export type Scene =
  | "menu"
  | "difficulty"
  | "scenarioList"
  | "scenarioPlay"
  | "cpuSetup"
  | "cpuPlay"
  | "cpuReview";

const VALID_SCENES = new Set<string>([
  "menu",
  "difficulty",
  "scenarioList",
  "scenarioPlay",
  "cpuSetup",
  "cpuPlay",
  "cpuReview",
]);

/** ゲーム画面はランタイム状態が消えるため親画面にフォールバック */
const GAME_SCENE_FALLBACK: Partial<Record<Scene, Scene>> = {
  scenarioPlay: "scenarioList",
  cpuPlay: "cpuSetup",
  cpuReview: "cpuSetup",
};
export type Mode = "training" | "cpu";
export type Difficulty = ScenarioDifficulty;
export type TransitionDirection = "forward" | "back";

export interface AppState {
  scene: Scene;
  selectedMode: Mode | null;
  selectedDifficulty: ScenarioDifficulty | null;
  currentPage: number;
  selectedScenarioId: string | null;
  cpuDifficulty: CpuDifficulty | null;
  cpuPlayerFirst: boolean | null;
  reviewRecordId: string | null;
  reviewImported: boolean;
}

interface AppStoreState extends AppState {
  transitionDirection: TransitionDirection;
}

export const useAppStore = defineStore("app", {
  state: (): AppStoreState => ({
    scene: "menu",
    selectedMode: null,
    selectedDifficulty: null,
    currentPage: 0,
    selectedScenarioId: null,
    transitionDirection: "forward",
    cpuDifficulty: null,
    cpuPlayerFirst: null,
    reviewRecordId: null,
    reviewImported: false,
  }),

  actions: {
    selectMode(mode: Mode) {
      this.transitionDirection = "forward";
      this.selectedMode = mode;

      if (mode === "cpu") {
        this.scene = "cpuSetup";
      } else {
        this.scene = "difficulty";
      }

      this.pushHistory();
    },

    selectDifficulty(difficulty: ScenarioDifficulty) {
      if (!this.selectedMode) {
        console.error("Mode not selected");
        return;
      }
      this.transitionDirection = "forward";
      this.selectedDifficulty = difficulty;
      this.currentPage = 0;
      this.scene = "scenarioList";
      this.pushHistory();
    },

    selectScenario(scenarioId: string) {
      this.transitionDirection = "forward";
      this.selectedScenarioId = scenarioId;
      this.scene = "scenarioPlay";
      this.pushHistory();
    },

    goToMenu() {
      this.transitionDirection = "back";
      this.scene = "menu";
      this.selectedMode = null;
      this.selectedDifficulty = null;
      this.currentPage = 0;
      this.selectedScenarioId = null;
      this.cpuDifficulty = null;
      this.cpuPlayerFirst = null;
      this.reviewRecordId = null;
      this.reviewImported = false;
      this.pushHistory();
    },

    goToDifficulty() {
      this.transitionDirection = "back";
      this.scene = "difficulty";
      this.selectedDifficulty = null;
      this.currentPage = 0;
      this.selectedScenarioId = null;
      this.pushHistory();
    },

    goToScenarioList() {
      if (!this.selectedDifficulty) {
        console.error("Difficulty not selected");
        return;
      }
      this.transitionDirection = "back";
      this.scene = "scenarioList";
      this.selectedScenarioId = null;
      this.pushHistory();
    },

    goToCpuSetup() {
      this.transitionDirection = "back";
      this.scene = "cpuSetup";
      this.cpuDifficulty = null;
      this.cpuPlayerFirst = null;
      this.reviewImported = false;
      this.pushHistory();
    },

    startCpuGame(difficulty: CpuDifficulty, playerFirst: boolean) {
      this.transitionDirection = "forward";
      this.cpuDifficulty = difficulty;
      this.cpuPlayerFirst = playerFirst;
      this.scene = "cpuPlay";
      this.pushHistory();
    },

    openCpuReview(recordId: string) {
      this.transitionDirection = "forward";
      this.reviewRecordId = recordId;
      this.reviewImported = false;
      this.scene = "cpuReview";
      this.pushHistory();
    },

    openImportedReview() {
      this.transitionDirection = "forward";
      this.reviewImported = true;
      this.reviewRecordId = null;
      this.scene = "cpuReview";
      this.pushHistory();
    },

    setPage(page: number) {
      this.currentPage = page;
      this.pushHistory();
    },

    restoreState(state: Partial<AppState>) {
      this.transitionDirection = "back";
      if (state.scene) {
        this.scene = state.scene;
      }
      if (state.selectedMode !== undefined) {
        this.selectedMode = state.selectedMode;
      }
      if (state.selectedDifficulty !== undefined) {
        this.selectedDifficulty = state.selectedDifficulty;
      }
      if (state.currentPage !== undefined) {
        this.currentPage = state.currentPage;
      }
      if (state.selectedScenarioId !== undefined) {
        this.selectedScenarioId = state.selectedScenarioId;
      }
      if (state.cpuDifficulty !== undefined) {
        this.cpuDifficulty = state.cpuDifficulty;
      }
      if (state.cpuPlayerFirst !== undefined) {
        this.cpuPlayerFirst = state.cpuPlayerFirst;
      }
      if (state.reviewRecordId !== undefined) {
        this.reviewRecordId = state.reviewRecordId;
      }
      if (state.reviewImported !== undefined) {
        this.reviewImported = state.reviewImported;
      }
    },

    restoreCpuState(state: Partial<AppState>) {
      if (state.cpuDifficulty !== undefined) {
        this.cpuDifficulty = state.cpuDifficulty;
      }
      if (state.cpuPlayerFirst !== undefined) {
        this.cpuPlayerFirst = state.cpuPlayerFirst;
      }
    },

    /** 現在の状態をシリアライズ */
    _buildState(): AppState {
      return {
        scene: this.scene,
        selectedMode: this.selectedMode,
        selectedDifficulty: this.selectedDifficulty,
        currentPage: this.currentPage,
        selectedScenarioId: this.selectedScenarioId,
        cpuDifficulty: this.cpuDifficulty,
        cpuPlayerFirst: this.cpuPlayerFirst,
        reviewRecordId: this.reviewRecordId,
        reviewImported: this.reviewImported,
      };
    },

    pushHistory() {
      const state = this._buildState();
      const url = `#${this.scene}`;
      if (window.navigation) {
        window.navigation.navigate(url, {
          state,
          history: "push",
        });
      } else {
        window.history.pushState(state, "", url);
      }
    },

    replaceHistory() {
      const state = this._buildState();
      const url = `#${this.scene}`;
      if (window.navigation) {
        window.navigation.navigate(url, {
          state,
          history: "replace",
        });
      } else {
        window.history.replaceState(state, "", url);
      }
    },

    /**
     * ブラウザの履歴 state またはハッシュから画面を復元する。
     * リロードやハッシュ直指定に対応。
     * @returns 復元できた場合 true
     */
    tryRestoreFromBrowser(): boolean {
      // 1. history.state / Navigation API state から復元（リロード時）
      const browserState = window.navigation
        ? (window.navigation.currentEntry?.getState() as
            | AppState
            | undefined
            | null)
        : (window.history.state as AppState | undefined | null);

      if (browserState?.scene && VALID_SCENES.has(browserState.scene)) {
        const state = { ...browserState };

        // ゲーム画面は親にフォールバック
        const fallback = GAME_SCENE_FALLBACK[state.scene];
        if (fallback) {
          state.scene = fallback;
          state.selectedScenarioId = null;
          state.reviewRecordId = null;
          state.reviewImported = false;
        }

        // 必須状態が欠けていたらさらにフォールバック
        if (state.scene === "scenarioList" && !state.selectedDifficulty) {
          state.scene = state.selectedMode ? "difficulty" : "menu";
        }
        if (state.scene === "difficulty" && !state.selectedMode) {
          state.scene = "menu";
        }
        if (state.scene === "cpuSetup") {
          state.selectedMode = "cpu";
        }

        if (state.scene === "menu") {
          return false; // デフォルトと同じなので復元不要
        }

        this.restoreState(state);
        this.replaceHistory();
        return true;
      }

      // 2. ハッシュのみ（直リンク、state なし）
      const hash = location.hash.slice(1);
      if (!hash || !VALID_SCENES.has(hash) || hash === "menu") {
        return false;
      }

      switch (hash as Scene) {
        case "cpuSetup":
          this.selectedMode = "cpu";
          this.scene = "cpuSetup";
          break;
        case "difficulty":
          this.selectedMode = "training";
          this.scene = "difficulty";
          break;
        default:
          return false; // 他は必要な状態が推定できないため復元不可
      }

      this.replaceHistory();
      return true;
    },
  },
});
