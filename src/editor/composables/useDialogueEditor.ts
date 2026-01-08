import { computed, type ComputedRef } from "vue";

import type {
  DemoSection,
  DemoDialogue,
  ProblemSection,
} from "@/types/scenario";

import { useEditorStore } from "@/editor/stores/editorStore";
import { generateDialogueId } from "@/logic/scenarioFileHandler";

export type DialogueSection = DemoSection | ProblemSection;

interface UseDialogueEditorReturn {
  dialogues: ComputedRef<DemoDialogue[]>;
  addDialogue: () => void;
  insertDialogueAfter: (index: number) => void;
  removeDialogue: (index: number) => void;
  updateDialogue: (index: number, updates: Partial<DemoDialogue>) => void;
  moveDialogueUp: (index: number) => void;
  moveDialogueDown: (index: number) => void;
}

export function useDialogueEditor(
  getCurrentSection: () => DialogueSection | null,
): UseDialogueEditorReturn {
  const editorStore = useEditorStore();

  const dialogues: ComputedRef<DemoDialogue[]> = computed(() => {
    const section = getCurrentSection();
    return section ? section.dialogues : [];
  });

  const addDialogue = (): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const newDialogues = [...section.dialogues];
    const newDialogue: DemoDialogue = {
      id: generateDialogueId(newDialogues),
      character: "fubuki",
      text: [],
      emotion: 0,
      boardActions: [],
    };
    newDialogues.push(newDialogue);

    editorStore.updateCurrentSection({
      dialogues: newDialogues,
    });
  };

  const insertDialogueAfter = (index: number): void => {
    const section = getCurrentSection();
    if (!section || index < 0 || index >= section.dialogues.length) {
      return;
    }

    const newDialogues = [...section.dialogues];
    const newDialogue: DemoDialogue = {
      id: generateDialogueId(newDialogues),
      character: "fubuki",
      text: [],
      emotion: 0,
      boardActions: [],
    };
    newDialogues.splice(index + 1, 0, newDialogue);
    // 挿入下次以降のIDを再採番
    newDialogues.forEach((dialogue, idx) => {
      dialogue.id = `dialogue_${idx + 1}`;
    });

    editorStore.updateCurrentSection({
      dialogues: newDialogues,
    });
  };

  const removeDialogue = (index: number): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const newDialogues = section.dialogues.filter((_, i) => i !== index);
    // 削除後に残りのダイアログのIDを再採番
    newDialogues.forEach((dialogue, idx) => {
      dialogue.id = `dialogue_${idx + 1}`;
    });

    editorStore.updateCurrentSection({
      dialogues: newDialogues,
    });
  };

  const updateDialogue = (
    index: number,
    updates: Partial<DemoDialogue>,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const newDialogues = [...section.dialogues];
    newDialogues[index] = { ...newDialogues[index], ...updates };

    editorStore.updateCurrentSection({
      dialogues: newDialogues,
    });
  };

  const moveDialogueUp = (index: number): void => {
    if (index <= 0) {
      return;
    }

    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const newDialogues = [...section.dialogues];
    [newDialogues[index], newDialogues[index - 1]] = [
      newDialogues[index - 1],
      newDialogues[index],
    ];

    editorStore.updateCurrentSection({
      dialogues: newDialogues,
    });
  };

  const moveDialogueDown = (index: number): void => {
    const section = getCurrentSection();
    if (!section || index >= section.dialogues.length - 1) {
      return;
    }

    const newDialogues = [...section.dialogues];
    [newDialogues[index], newDialogues[index + 1]] = [
      newDialogues[index + 1],
      newDialogues[index],
    ];

    editorStore.updateCurrentSection({
      dialogues: newDialogues,
    });
  };

  return {
    dialogues,
    addDialogue,
    insertDialogueAfter,
    removeDialogue,
    updateDialogue,
    moveDialogueUp,
    moveDialogueDown,
  };
}
