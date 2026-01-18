import { computed, type ComputedRef } from "vue";

import type {
  DemoSection,
  DemoDialogue,
  QuestionSection,
} from "@/types/scenario";

import { useEditorStore } from "@/editor/stores/editorStore";
import { generateDialogueId } from "@/logic/scenarioFileHandler";

export type DialogueSection = DemoSection | QuestionSection;

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

    // プレビューを最後のダイアログに移動
    editorStore.goToLastDialogue();
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

    // プレビューを挿入されたダイアログに移動
    editorStore.goToDialogueIndex(index + 1);
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

    // プレビューを適切な位置に調整（範囲内に収める）
    const newIndex = Math.min(index, newDialogues.length - 1);
    editorStore.goToDialogueIndex(Math.max(0, newIndex));
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
    const existingDialogue = newDialogues[index];
    if (existingDialogue) {
      newDialogues[index] = { ...existingDialogue, ...updates };
    }

    editorStore.updateCurrentSection({
      dialogues: newDialogues,
    });

    // プレビューを編集中のダイアログに移動
    editorStore.goToDialogueIndex(index);
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
    const curr = newDialogues[index];
    const prev = newDialogues[index - 1];
    if (curr && prev) {
      [newDialogues[index], newDialogues[index - 1]] = [prev, curr];
    }

    editorStore.updateCurrentSection({
      dialogues: newDialogues,
    });

    // プレビューを移動先のダイアログに追従
    editorStore.goToDialogueIndex(index - 1);
  };

  const moveDialogueDown = (index: number): void => {
    const section = getCurrentSection();
    if (!section || index >= section.dialogues.length - 1) {
      return;
    }

    const newDialogues = [...section.dialogues];
    const curr = newDialogues[index];
    const next = newDialogues[index + 1];
    if (curr && next) {
      [newDialogues[index], newDialogues[index + 1]] = [next, curr];
    }

    editorStore.updateCurrentSection({
      dialogues: newDialogues,
    });

    // プレビューを移動先のダイアログに追従
    editorStore.goToDialogueIndex(index + 1);
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
