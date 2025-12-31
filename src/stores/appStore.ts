import { defineStore } from "pinia";

export type Scene = "menu" | "difficulty" | "scenarioList" | "scenarioPlay";
export type Mode = "training" | "cpu";
export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface AppState {
  scene: Scene;
  selectedMode: Mode | null;
  selectedDifficulty: Difficulty | null;
  currentPage: number;
  selectedScenarioId: string | null;
}

export const useAppStore = defineStore("app", {
  state: (): AppState => ({
    scene: "menu",
    selectedMode: null,
    selectedDifficulty: null,
    currentPage: 0,
    selectedScenarioId: null,
  }),

  actions: {
    selectMode(mode: Mode) {
      if (mode === "cpu") {
        // CPU対戦は未実装
        return;
      }
      this.selectedMode = mode;
      this.scene = "difficulty";
    },

    selectDifficulty(difficulty: Difficulty) {
      if (!this.selectedMode) {
        console.error("Mode not selected");
        return;
      }
      this.selectedDifficulty = difficulty;
      this.currentPage = 0;
      this.scene = "scenarioList";
    },

    selectScenario(scenarioId: string) {
      this.selectedScenarioId = scenarioId;
      this.scene = "scenarioPlay";
    },

    goToMenu() {
      this.scene = "menu";
      this.selectedMode = null;
      this.selectedDifficulty = null;
      this.currentPage = 0;
      this.selectedScenarioId = null;
    },

    goToDifficulty() {
      this.scene = "difficulty";
      this.selectedDifficulty = null;
      this.currentPage = 0;
      this.selectedScenarioId = null;
    },

    goToScenarioList() {
      if (!this.selectedDifficulty) {
        console.error("Difficulty not selected");
        return;
      }
      this.scene = "scenarioList";
      this.selectedScenarioId = null;
    },

    setPage(page: number) {
      this.currentPage = page;
    },

    restoreState(state: Partial<AppState>) {
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
    },

    pushHistory() {
      const state: AppState = {
        scene: this.scene,
        selectedMode: this.selectedMode,
        selectedDifficulty: this.selectedDifficulty,
        currentPage: this.currentPage,
        selectedScenarioId: this.selectedScenarioId,
      };
      window.history.pushState(state, "", `#${this.scene}`);
    },
  },
});
