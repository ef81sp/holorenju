import { defineStore } from "pinia";

import type { CpuDifficulty } from "@/types/cpu";
import type { ScenarioDifficulty } from "@/types/scenario";

export type Scene =
  | "menu"
  | "difficulty"
  | "scenarioList"
  | "scenarioPlay"
  | "editor"
  | "cpuSetup"
  | "cpuPlay";
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

    goToEditor() {
      this.transitionDirection = "forward";
      this.scene = "editor";
      this.pushHistory();
    },

    goToCpuSetup() {
      this.transitionDirection = "back";
      this.scene = "cpuSetup";
      this.cpuDifficulty = null;
      this.cpuPlayerFirst = null;
      this.pushHistory();
    },

    startCpuGame(difficulty: CpuDifficulty, playerFirst: boolean) {
      this.transitionDirection = "forward";
      this.cpuDifficulty = difficulty;
      this.cpuPlayerFirst = playerFirst;
      this.scene = "cpuPlay";
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
      };
      window.history.pushState(state, "", `#${this.scene}`);
    },
  },
});
