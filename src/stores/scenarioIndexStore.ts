import { defineStore } from "pinia";
import { ref } from "vue";

import type {
  DifficultyData,
  ScenarioIndex,
  ScenarioMeta,
} from "@/types/scenario";

export type { DifficultyData, ScenarioIndex, ScenarioMeta };

export const useScenarioIndexStore = defineStore("scenarioIndex", () => {
  const index = ref<ScenarioIndex | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const loadIndex = async (): Promise<void> => {
    if (index.value || isLoading.value) {
      return;
    }
    isLoading.value = true;
    error.value = null;
    try {
      const res = await fetch("/scenarios/index.json");
      if (!res.ok) {
        throw new Error(`HTTP error: ${res.status}`);
      }
      index.value = await res.json();
    } catch (e) {
      error.value = "シナリオ一覧の読み込みに失敗しました";
      console.error(e);
    } finally {
      isLoading.value = false;
    }
  };

  const findScenarioPath = (scenarioId: string): string | null => {
    if (!index.value) {
      return null;
    }
    for (const difficultyData of Object.values(index.value.difficulties)) {
      const found = difficultyData.scenarios.find((s) => s.id === scenarioId);
      if (found) {
        return found.path;
      }
    }
    return null;
  };

  return { index, isLoading, error, loadIndex, findScenarioPath };
});
