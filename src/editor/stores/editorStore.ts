/**
 * シナリオエディタ状態管理ストア
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";

import type { Scenario, Section } from "@/types/scenario";

import {
  createEmptyScenario,
  createEmptyDemoSection,
  createEmptyQuestionSection,
  generateSectionId,
} from "@/logic/scenarioFileHandler";

export const useEditorStore = defineStore("editor", () => {
  // State
  const scenario = ref<Scenario>(createEmptyScenario());
  const selectedSectionIndex = ref<number | null>(null);
  const validationErrors = ref<{ path: string; message: string }[]>([]);
  const isDirty = ref(false);
  const previewDialogueIndex = ref(0);

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
      previewDialogueIndex.value = 0;
    }
  };

  const addSection = (type: "demo" | "question"): void => {
    const newSection: Section =
      type === "demo"
        ? (createEmptyDemoSection() as Section)
        : (createEmptyQuestionSection() as Section);
    // 自動採番IDを設定
    newSection.id = generateSectionId(scenario.value.sections);

    scenario.value.sections.push(newSection);
    selectedSectionIndex.value = scenario.value.sections.length - 1;
    isDirty.value = true;
  };

  const removeSection = (index: number): void => {
    scenario.value.sections.splice(index, 1);
    // 削除後に残りのセクションのIDを再採番
    scenario.value.sections.forEach((section, idx) => {
      section.id = `section_${idx + 1}`;
    });
    if (selectedSectionIndex.value === index) {
      selectedSectionIndex.value = null;
    }
    isDirty.value = true;
  };

  const moveSectionUp = (index: number): void => {
    if (index <= 0) {
      return;
    }
    // eslint-disable-next-line prefer-destructuring
    const sections = scenario.value.sections;
    const prev = sections[index - 1];
    const curr = sections[index];
    if (!prev || !curr) {
      return;
    }
    [sections[index - 1], sections[index]] = [curr, prev];
    // 並べ替え後にIDを再採番
    sections.forEach((section, idx) => {
      section.id = `section_${idx + 1}`;
    });
    // 選択状態を移動
    if (selectedSectionIndex.value === index) {
      selectedSectionIndex.value = index - 1;
    } else if (selectedSectionIndex.value === index - 1) {
      selectedSectionIndex.value = index;
    }
    isDirty.value = true;
  };

  const moveSectionDown = (index: number): void => {
    if (index >= scenario.value.sections.length - 1) {
      return;
    }
    // eslint-disable-next-line prefer-destructuring
    const sections = scenario.value.sections;
    const curr = sections[index];
    const next = sections[index + 1];
    if (!curr || !next) {
      return;
    }
    [sections[index], sections[index + 1]] = [next, curr];
    // 並べ替え後にIDを再採番
    sections.forEach((section, idx) => {
      section.id = `section_${idx + 1}`;
    });
    // 選択状態を移動
    if (selectedSectionIndex.value === index) {
      selectedSectionIndex.value = index + 1;
    } else if (selectedSectionIndex.value === index + 1) {
      selectedSectionIndex.value = index;
    }
    isDirty.value = true;
  };

  const moveDialogueUp = (dialogueIndex: number): void => {
    if (selectedSectionIndex.value === null) {
      return;
    }
    const section = scenario.value.sections[selectedSectionIndex.value];
    if (!section || section.type !== "demo" || dialogueIndex <= 0) {
      return;
    }
    const { dialogues } = section;
    const prev = dialogues[dialogueIndex - 1];
    const curr = dialogues[dialogueIndex];
    if (!prev || !curr) {
      return;
    }
    [dialogues[dialogueIndex - 1], dialogues[dialogueIndex]] = [curr, prev];
    // 並べ替え後にIDを再採番
    dialogues.forEach((dialogue, idx) => {
      dialogue.id = `dialogue_${idx + 1}`;
    });
    isDirty.value = true;
  };

  const moveDialogueDown = (dialogueIndex: number): void => {
    if (selectedSectionIndex.value === null) {
      return;
    }
    const section = scenario.value.sections[selectedSectionIndex.value];
    if (
      !section ||
      section.type !== "demo" ||
      dialogueIndex >= section.dialogues.length - 1
    ) {
      return;
    }
    const { dialogues } = section;
    const curr = dialogues[dialogueIndex];
    const next = dialogues[dialogueIndex + 1];
    if (!curr || !next) {
      return;
    }
    [dialogues[dialogueIndex], dialogues[dialogueIndex + 1]] = [next, curr];
    // 並べ替え後にIDを再採番
    dialogues.forEach((dialogue, idx) => {
      dialogue.id = `dialogue_${idx + 1}`;
    });
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

  const changeCurrentSectionType = (type: "demo" | "question"): void => {
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
        : (createEmptyQuestionSection() as Section);

    const updated: Section = {
      ...base,
      id: current.id,
      title: current.title,
      initialBoard: current.initialBoard,
    } as Section;

    scenario.value.sections[selectedSectionIndex.value] = updated;
    isDirty.value = true;
  };

  const setValidationErrors = (
    errors: { path: string; message: string }[],
  ): void => {
    validationErrors.value = errors;
  };

  const clearValidationErrors = (): void => {
    validationErrors.value = [];
  };

  const setPreviewDialogueIndex = (index: number): void => {
    previewDialogueIndex.value = index;
  };

  const goToLastDialogue = (): void => {
    const section = currentSection.value;
    if (section && "dialogues" in section) {
      previewDialogueIndex.value = Math.max(0, section.dialogues.length - 1);
    }
  };

  const goToDialogueIndex = (index: number): void => {
    const section = currentSection.value;
    if (section && "dialogues" in section) {
      const maxIndex = Math.max(0, section.dialogues.length - 1);
      previewDialogueIndex.value = Math.max(0, Math.min(index, maxIndex));
    }
  };

  const markClean = (): void => {
    isDirty.value = false;
  };

  return {
    scenario,
    selectedSectionIndex,
    validationErrors,
    isDirty,
    previewDialogueIndex,
    currentSection,
    hasErrors,
    loadScenario,
    updateScenarioInfo,
    selectSection,
    addSection,
    removeSection,
    moveSectionUp,
    moveSectionDown,
    moveDialogueUp,
    moveDialogueDown,
    updateCurrentSection,
    changeCurrentSectionType,
    setValidationErrors,
    clearValidationErrors,
    setPreviewDialogueIndex,
    goToLastDialogue,
    goToDialogueIndex,
    markClean,
  };
});
