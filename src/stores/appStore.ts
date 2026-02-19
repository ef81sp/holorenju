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

    pushHistory() {
      const state: AppState = {
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
      window.history.pushState(state, "", `#${this.scene}`);
    },
  },
});
