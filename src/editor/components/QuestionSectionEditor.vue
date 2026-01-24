<script setup lang="ts">
import { computed, type PropType } from "vue";
import { useEditorStore } from "@/editor/stores/editorStore";
import BoardVisualEditor from "./BoardVisualEditor.vue";
import SuccessConditionsEditor from "./QuestionSectionEditor/SuccessConditionsEditor.vue";
import FeedbackEditor from "./QuestionSectionEditor/FeedbackEditor.vue";
import DialogueListEditor from "./QuestionSectionEditor/DialogueListEditor.vue";
import { useDialogueEditor } from "@/editor/composables/useDialogueEditor";
import { parseText, stringifyText } from "@/logic/textParser";
import type { QuestionSection } from "@/types/scenario";

const editorStore = useEditorStore();

const props = defineProps({
  view: {
    type: String as PropType<"full" | "meta" | "content">,
    default: "full",
  },
});

const currentSection = computed<QuestionSection | null>(() => {
  const section = editorStore.currentSection;
  return section && section.type === "question"
    ? (section as QuestionSection)
    : null;
});

const descriptionText = computed(() =>
  stringifyText(currentSection.value?.description || []),
);

const getCurrentSection = (): QuestionSection | null => currentSection.value;
const updateSection = (updates: Partial<QuestionSection>): void => {
  editorStore.updateCurrentSection(updates);
};

// ダイアログ管理
const { addDialogue, insertDialogueAfter, removeDialogue, updateDialogue } =
  useDialogueEditor(getCurrentSection);

const updateBoard = (newBoard: string[]): void => {
  if (currentSection.value) {
    updateSection({
      initialBoard: newBoard,
    });
  }
};

const updateDescription = (description: string): void => {
  updateSection({
    description: parseText(description),
  });
};

const updateSuccessOperator = (operator: "or" | "and"): void => {
  updateSection({ successOperator: operator });
};
</script>

<template>
  <div
    v-if="currentSection"
    class="question-section-editor"
  >
    <div class="detail-grid">
      <div
        v-if="props.view !== 'content'"
        class="detail-left"
      >
        <!-- 説明編集 -->
        <div class="description-editor">
          <div class="form-group">
            <label>説明</label>
            <textarea
              :value="descriptionText"
              class="form-textarea"
              rows="4"
              @input="
                updateDescription(($event.target as HTMLTextAreaElement).value)
              "
            />
          </div>
        </div>
      </div>

      <div
        v-if="props.view !== 'meta'"
        class="detail-right"
      >
        <!-- 盤面エディタ -->
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

        <!-- ダイアログ -->
        <DialogueListEditor
          :dialogues="currentSection.dialogues"
          @add="addDialogue"
          @add-after="insertDialogueAfter"
          @update="updateDialogue"
          @remove="removeDialogue"
        />

        <!-- 成功条件 -->
        <SuccessConditionsEditor
          :conditions="currentSection.successConditions"
          :operator="currentSection.successOperator || 'or'"
          :get-current-section="getCurrentSection"
          :update-section="updateSection"
          :update-success-operator="updateSuccessOperator"
        />

        <!-- ヒント機能は廃止されました -->

        <!-- フィードバック -->
        <FeedbackEditor
          :feedback="currentSection.feedback"
          :get-current-section="getCurrentSection"
          :update-section="updateSection"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.question-section-editor {
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

.board-editor-wrapper {
  background-color: var(--color-bg-gray);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: var(--size-6);
}

.board-editor-wrapper summary {
  cursor: pointer;
  font-weight: 600;
  font-size: var(--size-12);
  margin-bottom: var(--size-5);
  user-select: none;
}

.board-editor-wrapper summary:hover {
  color: #4a90e2;
}

.description-editor {
  display: flex;
  flex-direction: column;
  gap: var(--form-group-gap);
  padding: var(--padding-md);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--form-label-gap);
}

.form-group label {
  font-weight: 500;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}

.form-textarea {
  padding: var(--input-padding);
  border: var(--border-input);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-base);
  font-family: inherit;
  resize: vertical;

  &:focus {
    outline: none;
    border-color: var(--border-focus);
    box-shadow: var(--shadow-focus);
  }
}
</style>
