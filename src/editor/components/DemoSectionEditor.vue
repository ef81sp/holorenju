<script setup lang="ts">
import { computed, type PropType } from "vue";
import BoardVisualEditor from "./BoardVisualEditor.vue";
import DialogueItemWithActions from "./DemoSectionEditor/DialogueItemWithActions.vue";
import { useEditorStore } from "@/editor/stores/editorStore";
import type { DemoSection, DemoDialogue } from "@/types/scenario";
import { generateDialogueId } from "@/logic/scenarioFileHandler";

const props = defineProps({
  view: {
    type: String as PropType<"full" | "meta" | "content">,
    default: "full",
  },
});

const editorStore = useEditorStore();

const currentSection = computed<DemoSection | null>(() => {
  const section = editorStore.currentSection;
  return section && section.type === "demo" ? (section as DemoSection) : null;
});

const getCurrentSection = (): DemoSection | null => currentSection.value;

const updateBoard = (newBoard: string[]): void => {
  if (!currentSection.value) {
    return;
  }
  editorStore.updateCurrentSection({
    ...currentSection.value,
    initialBoard: newBoard,
  });
};

const updateSectionTitle = (title: string): void => {
  if (!currentSection.value) {
    return;
  }
  editorStore.updateCurrentSection({
    ...currentSection.value,
    title,
  });
};

const addDialogue = (): void => {
  if (!currentSection.value) {
    return;
  }
  const newDialogues = [...currentSection.value.dialogues];
  const newDialogue: DemoDialogue = {
    id: generateDialogueId(newDialogues),
    character: "fubuki",
    text: [],
    emotion: 0,
    boardActions: [],
  };
  newDialogues.push(newDialogue);
  editorStore.updateCurrentSection({
    ...currentSection.value,
    dialogues: newDialogues,
  });
};

const removeDialogue = (index: number): void => {
  if (!currentSection.value) {
    return;
  }
  const newDialogues = currentSection.value.dialogues.filter(
    (_, i) => i !== index,
  );
  newDialogues.forEach((dialogue, idx) => {
    dialogue.id = `dialogue_${idx + 1}`;
  });
  editorStore.updateCurrentSection({
    ...currentSection.value,
    dialogues: newDialogues,
  });
};

const updateDialogue = (
  index: number,
  updates: Partial<DemoDialogue>,
): void => {
  if (!currentSection.value) {
    return;
  }
  const newDialogues = [...currentSection.value.dialogues];
  newDialogues[index] = { ...newDialogues[index], ...updates };
  editorStore.updateCurrentSection({
    ...currentSection.value,
    dialogues: newDialogues,
  });
};
</script>

<template>
  <div
    v-if="currentSection"
    class="demo-section-editor"
  >
    <div class="detail-grid">
      <div
        v-if="props.view !== 'content'"
        class="detail-left"
      >
        <div class="form-group">
          <label for="demo-title">セクションタイトル</label>
          <input
            id="demo-title"
            type="text"
            :value="currentSection.title"
            class="form-input"
            @input="
              (e) => updateSectionTitle((e.target as HTMLInputElement).value)
            "
          />
        </div>
      </div>

      <div
        v-if="props.view !== 'meta'"
        class="detail-right"
      >
        <details
          class="board-editor-wrapper"
          open
        >
          <summary>初期盤面</summary>
          <BoardVisualEditor
            :board="currentSection.initialBoard"
            @update:board="updateBoard"
          />
        </details>

        <details
          class="dialogues-section"
          open
        >
          <summary class="dialogues-header">
            <span>ダイアログ</span>
            <button
              type="button"
              class="btn-add-small"
              @click.stop.prevent="addDialogue"
            >
              + ダイアログを追加
            </button>
          </summary>

          <div
            v-if="currentSection.dialogues.length === 0"
            class="empty-state"
          >
            ダイアログがありません
          </div>

          <div
            v-else
            class="dialogues-list"
          >
            <DialogueItemWithActions
              v-for="(dialogue, index) in currentSection.dialogues"
              :key="dialogue.id"
              :dialogue="dialogue"
              :dialogue-index="index"
              :dialogue-count="currentSection.dialogues.length"
              :get-current-section="getCurrentSection"
              :update-dialogue="updateDialogue"
              @move-up="editorStore.moveDialogueUp(index)"
              @move-down="editorStore.moveDialogueDown(index)"
              @remove="removeDialogue(index)"
            />
          </div>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.demo-section-editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--size-8);
  align-items: start;
}

.detail-left,
.detail-right {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
}

.form-group label {
  font-weight: var(--font-weight-bold);
  font-size: var(--size-12);
}

.form-input {
  padding: var(--size-4);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: var(--size-12);
  font-family: inherit;
  background: var(--color-bg-white);
}

.form-input:focus {
  outline: none;
  border-color: var(--color-holo-blue);
}

.board-editor-wrapper {
  background-color: var(--color-bg-gray);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: var(--size-6);
}

.board-editor-wrapper summary {
  cursor: pointer;
  font-weight: var(--font-weight-bold);
  font-size: var(--size-12);
  margin-bottom: var(--size-5);
  user-select: none;
}

.dialogues-section {
  padding: var(--size-6);
  background-color: var(--color-bg-gray);
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.dialogues-section summary {
  cursor: pointer;
  user-select: none;
}

.dialogues-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: var(--font-weight-bold);
  font-size: var(--size-12);
  margin-bottom: var(--size-5);
}

.dialogues-header span {
  flex: 1;
}

.btn-add-small {
  padding: var(--size-2) var(--size-6);
  background-color: var(--color-holo-blue);
  color: white;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-10);
}

.btn-add-small:hover {
  opacity: 0.9;
}

.empty-state {
  padding: var(--size-8);
  text-align: center;
  color: var(--color-text-secondary);
  background-color: var(--color-bg-white);
  border-radius: 3px;
  font-size: var(--size-12);
  border: 1px dashed var(--color-border);
}

.dialogues-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}
</style>
