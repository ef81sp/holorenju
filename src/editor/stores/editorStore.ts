/**
 * シナリオエディタ状態管理ストア
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";

import type { Scenario, Section } from "@/types/scenario";

import {
  createEmptyScenario,
  createEmptyDemoSection,
  createEmptyProblemSection,
} from "@/logic/scenarioFileHandler";

export const useEditorStore = defineStore("editor", () => {
  // State
  const scenario = ref<Scenario>(createEmptyScenario());
  const selectedSectionIndex = ref<number | null>(null);
  const validationErrors = ref<{ path: string; message: string }[]>([]);
  const isDirty = ref(false);

  // Computed
  const currentSection = computed<Section | null>(() => {
    if (selectedSectionIndex.value === null) {
      return null;
    }
    return scenario.value.sections[selectedSectionIndex.value] ?? null;
  });

  const hasErrors = computed(() => validationErrors.value.length > 0);

  // Methods
  const loadScenario = (newScenario: Scenario): void => {
    scenario.value = newScenario;
    selectedSectionIndex.value = null;
    isDirty.value = false;
    validationErrors.value = [];
  };

  const updateScenarioInfo = (
    updates: Partial<
      Pick<
        Scenario,
        "id" | "title" | "difficulty" | "description" | "objectives"
      >
    >,
  ): void => {
    scenario.value = { ...scenario.value, ...updates };
    isDirty.value = true;
  };

  const selectSection = (index: number): void => {
    if (index >= 0 && index < scenario.value.sections.length) {
      selectedSectionIndex.value = index;
    }
  };

  const addSection = (type: "demo" | "problem"): void => {
    const newSection: Section =
      type === "demo"
        ? (createEmptyDemoSection() as Section)
        : (createEmptyProblemSection() as Section);
    // ID を一意にする
    const existingIds = scenario.value.sections.map((s) => s.id);
    let { id } = newSection;
    let counter = 1;
    while (existingIds.includes(id)) {
      id = `${newSection.id}_${counter}`;
      counter++;
    }
    newSection.id = id;

    scenario.value.sections.push(newSection);
    selectedSectionIndex.value = scenario.value.sections.length - 1;
    isDirty.value = true;
  };

  const removeSection = (index: number): void => {
    scenario.value.sections.splice(index, 1);
    if (selectedSectionIndex.value === index) {
      selectedSectionIndex.value = null;
    }
    isDirty.value = true;
  };

  const updateCurrentSection = (updates: Partial<Section>): void => {
    if (selectedSectionIndex.value !== null) {
      scenario.value.sections[selectedSectionIndex.value] = {
        ...scenario.value.sections[selectedSectionIndex.value],
        ...updates,
      } as Section;
      isDirty.value = true;
    }
  };

  const changeCurrentSectionType = (type: "demo" | "problem"): void => {
    if (selectedSectionIndex.value === null) {
      return;
    }
    const current = scenario.value.sections[selectedSectionIndex.value];
    if (!current || current.type === type) {
      return;
    }

    const base =
      type === "demo"
        ? (createEmptyDemoSection() as Section)
        : (createEmptyProblemSection() as Section);

    const updated: Section = {
      ...base,
      id: current.id,
      title: current.title,
      initialBoard: current.initialBoard,
    } as Section;

    scenario.value.sections[selectedSectionIndex.value] = updated;
    isDirty.value = true;
  };

  const setValidationErrors = (errors: { path: string; message: string }[]): void => {
    validationErrors.value = errors;
  };

  const clearValidationErrors = (): void => {
    validationErrors.value = [];
  };

  const markClean = (): void => {
    isDirty.value = false;
  };

  return {
    scenario,
    selectedSectionIndex,
    validationErrors,
    isDirty,
    currentSection,
    hasErrors,
    loadScenario,
    updateScenarioInfo,
    selectSection,
    addSection,
    removeSection,
    updateCurrentSection,
    changeCurrentSectionType,
    setValidationErrors,
    clearValidationErrors,
    markClean,
  };
});
