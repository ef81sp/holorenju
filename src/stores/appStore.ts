/// <reference types="navigation-api-types" />
import { defineStore } from "pinia";

import type { CpuDifficulty } from "@/types/cpu";
import type { PlayerSide } from "@/types/review";
import type { ScenarioDifficulty } from "@/types/scenario";

import { validateGameRecord } from "@/logic/gameRecordValidator";

import { useCpuReviewStore } from "./cpuReviewStore";

/** シナリオ難易度 → URL略称 */
const DIFFICULTY_TO_ABBR: Record<ScenarioDifficulty, string> = {
  gomoku_beginner: "gb",
  gomoku_intermediate: "gi",
  renju_beginner: "rb",
  renju_intermediate: "ri",
  renju_advanced: "ra",
  renju_expert: "re",
};

/** URL略称 → シナリオ難易度 */
const ABBR_TO_DIFFICULTY: Record<string, ScenarioDifficulty> =
  Object.fromEntries(
    Object.entries(DIFFICULTY_TO_ABBR).map(([k, v]) => [
      v,
      k as ScenarioDifficulty,
    ]),
  ) as Record<string, ScenarioDifficulty>;

/** CPU難易度 → URL略称 */
const CPU_DIFF_TO_ABBR: Record<CpuDifficulty, string> = {
  beginner: "b",
  easy: "e",
  medium: "m",
  hard: "h",
};

/** URL略称 → CPU難易度 */
const ABBR_TO_CPU_DIFF: Record<string, CpuDifficulty> = Object.fromEntries(
  Object.entries(CPU_DIFF_TO_ABBR).map(([k, v]) => [v, k as CpuDifficulty]),
) as Record<string, CpuDifficulty>;

/** PlayerSide → URL略称 */
const PLAYER_SIDE_TO_ABBR: Record<PlayerSide, string> = {
  black: "b",
  white: "w",
  both: "a",
};

/** URL略称 → PlayerSide */
const ABBR_TO_PLAYER_SIDE: Record<string, PlayerSide> = {
  b: "black",
  w: "white",
  a: "both",
};

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

    /** 現在の状態からURL文字列を構築（ハッシュの中身） */
    _buildUrl(): string {
      const u = new URL(this.scene, "http://x");

      switch (this.scene) {
        case "scenarioList":
        case "scenarioPlay":
          if (this.selectedDifficulty) {
            u.searchParams.set(
              "d",
              DIFFICULTY_TO_ABBR[this.selectedDifficulty],
            );
          }
          if (this.scene === "scenarioList" && this.currentPage > 0) {
            u.searchParams.set("p", String(this.currentPage));
          }
          if (this.scene === "scenarioPlay" && this.selectedScenarioId) {
            u.searchParams.set("s", this.selectedScenarioId);
          }
          break;
        case "cpuPlay":
          if (this.cpuDifficulty) {
            u.searchParams.set("cd", CPU_DIFF_TO_ABBR[this.cpuDifficulty]);
          }
          if (this.cpuPlayerFirst !== null) {
            u.searchParams.set("f", this.cpuPlayerFirst ? "1" : "0");
          }
          break;
        case "cpuReview": {
          const reviewStore = useCpuReviewStore();
          const history = reviewStore.moveHistory;
          if (history) {
            u.searchParams.set("g", history.replace(/ /g, "."));
            u.searchParams.set(
              "ps",
              PLAYER_SIDE_TO_ABBR[reviewStore.currentPlayerSide],
            );
          }
          if (this.reviewRecordId) {
            u.searchParams.set("r", this.reviewRecordId);
          }
          break;
        }
        default:
          break;
      }

      return u.pathname.slice(1) + u.search;
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
      const url = `#${this._buildUrl()}`;
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
      const url = `#${this._buildUrl()}`;
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
     * ブラウザの履歴 state またはハッシュ+クエリパラメータから画面を復元する。
     * SSoT = URL: クエリパラメータ最優先、history.stateは transitionDirection のみ。
     * @returns 復元できた場合 true
     */
    tryRestoreFromBrowser(): boolean {
      const raw = location.hash.slice(1); // "#scenarioList?d=rb" → "scenarioList?d=rb"
      if (!raw) {
        return false;
      }

      // URLパース
      const u = new URL(raw, location.origin);
      const sceneName = u.pathname.slice(1);

      if (!VALID_SCENES.has(sceneName)) {
        return false;
      }

      let scene = sceneName as Scene;
      const params = u.searchParams;

      // シーンからモードを推定
      const mode = this._inferMode(scene);

      // 状態をパースして構築
      const state: Partial<AppState> = {
        scene,
        selectedMode: mode,
      };

      // シーン別パラメータ解析
      switch (scene) {
        case "scenarioList":
        case "scenarioPlay": {
          const dAbbr = params.get("d");
          const difficulty = dAbbr ? ABBR_TO_DIFFICULTY[dAbbr] : undefined;
          state.selectedDifficulty = difficulty ?? null;

          if (scene === "scenarioList") {
            const pStr = params.get("p");
            state.currentPage = pStr ? parseInt(pStr, 10) || 0 : 0;
          }
          if (scene === "scenarioPlay") {
            state.selectedScenarioId = params.get("s");
          }
          break;
        }
        case "cpuPlay": {
          const cdAbbr = params.get("cd");
          state.cpuDifficulty = cdAbbr
            ? (ABBR_TO_CPU_DIFF[cdAbbr] ?? null)
            : null;
          const fStr = params.get("f");
          if (fStr === "1") {
            state.cpuPlayerFirst = true;
          } else if (fStr === "0") {
            state.cpuPlayerFirst = false;
          } else {
            state.cpuPlayerFirst = null;
          }
          break;
        }
        case "cpuReview": {
          const gParam = params.get("g");
          if (gParam) {
            // g パラメータ優先（r と同時の場合も g を使用）
            const moveHistoryStr = gParam.replace(/\./g, " ");
            const validation = validateGameRecord(moveHistoryStr);
            if (validation.valid) {
              const psAbbr = params.get("ps");
              const playerSide: PlayerSide =
                (psAbbr ? ABBR_TO_PLAYER_SIDE[psAbbr] : undefined) ?? "both";
              const reviewStore = useCpuReviewStore();
              reviewStore.openReviewFromImport(
                validation.normalizedRecord,
                playerSide,
              );
              state.reviewImported = true;
              state.reviewRecordId = null;
            } else {
              // 不正な棋譜 → フォールバック
              state.reviewImported = false;
              state.reviewRecordId = null;
            }
          } else {
            state.reviewRecordId = params.get("r") ?? null;
            state.reviewImported = false;
          }
          break;
        }
        default:
          break;
      }

      // ゲーム画面は親にフォールバック（reviewImported時は棋譜がURLにあるため抑制）
      if (!state.reviewImported) {
        const fallback = GAME_SCENE_FALLBACK[scene];
        if (fallback) {
          state.scene = fallback;
          state.selectedScenarioId = null;
          state.reviewRecordId = null;
          state.reviewImported = false;
        }
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
        return false;
      }

      this.restoreState(state as AppState);
      this.replaceHistory();
      return true;
    },

    /** シーン名からモードを推定 */
    _inferMode(scene: Scene): Mode | null {
      switch (scene) {
        case "difficulty":
        case "scenarioList":
        case "scenarioPlay":
          return "training";
        case "cpuSetup":
        case "cpuPlay":
        case "cpuReview":
          return "cpu";
        default:
          return null;
      }
    },
  },
});
