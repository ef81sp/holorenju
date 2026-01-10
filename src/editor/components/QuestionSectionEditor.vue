<script setup lang="ts">
import { computed, type PropType } from "vue";
import { useEditorStore } from "@/editor/stores/editorStore";
import SectionMetaEditor from "./SectionMetaEditor.vue";
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

const updateSectionTitle = (title: string): void => {
  updateSection({
    title,
  });
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
        <!-- セクション情報 -->
        <SectionMetaEditor
          :title="currentSection.title"
          :description="descriptionText"
          with-description
          @update:title="updateSectionTitle"
          @update:description="updateDescription"
        />
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

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
}

.form-group label {
  font-weight: 600;
  font-size: var(--size-12);
}

.form-input,
.form-textarea {
  padding: var(--size-2);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: var(--size-12);
  font-family: inherit;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: #4a90e2;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.05);
}

.form-textarea {
  resize: vertical;
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

.dialogues-section {
  padding: var(--size-6);
  background-color: var(--color-bg-gray);
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.dialogues-section summary {
  cursor: pointer;
  font-weight: 600;
  font-size: var(--size-12);
  margin-bottom: var(--size-5);
  user-select: none;
}

.dialogues-section summary:hover {
  color: #4a90e2;
}

.dialogues-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialogues-header span {
  flex: 1;
}

.dialogues-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
  max-height: var(--size-500);
  overflow-y: auto;
}

.dialogue-item {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  padding: var(--size-6);
  background-color: white;
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.dialogue-header {
  display: flex;
  gap: var(--size-2);
  align-items: center;
  flex-wrap: wrap;
}

.emotion-selector-button {
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  background-color: var(--color-bg-gray);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--size-10);
}

.emotion-selector-button:hover {
  background-color: #f0f0f0;
}

.emotion-selector-button .placeholder {
  color: var(--color-text-secondary);
}

.dialogue-actions-buttons {
  display: flex;
  gap: var(--size-2);
  margin-left: auto;
}

.btn-move {
  padding: var(--size-2) var(--size-5);
  background-color: var(--color-bg-gray);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-10);
}

.btn-move:hover:not(:disabled) {
  background-color: #f0f0f0;
}

.btn-move:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.conditions-section {
  padding: var(--size-6);
  background-color: var(--color-bg-gray);
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.conditions-section summary:hover {
  color: #4a90e2;
}

.conditions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.conditions-header span {
  flex: 1;
}

.btn-add-small {
  padding: var(--size-2) var(--size-6);
  background-color: #4a90e2;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-10);
  transition: opacity 0.2s;
}

.btn-add-small:hover {
  opacity: 0.9;
}

.empty-state {
  padding: var(--size-8);
  text-align: center;
  color: var(--color-text-secondary);
  background-color: white;
  border-radius: 3px;
  font-size: var(--size-12);
}

.conditions-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}

.condition-item {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  padding: var(--size-6);
  background-color: white;
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.condition-header {
  display: flex;
  gap: var(--size-2);
  align-items: center;
}

.form-input-small {
  flex: 1;
  min-width: 80px;
  padding: var(--size-2);
  font-size: var(--size-10);
}

.btn-remove-small {
  padding: var(--size-2) var(--size-5);
  background-color: #ff6b6b;
  border: none;
  cursor: pointer;
  font-size: var(--size-10);
  border-radius: 3px;
  transition: opacity 0.2s;
}

.btn-remove-small:hover {
  opacity: 0.8;
}

.condition-body {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  padding-top: var(--size-5);
}

.field-row {
  display: flex;
  gap: var(--size-5);
  flex-wrap: wrap;
  align-items: center;
}

.checkbox-row label {
  display: flex;
  gap: var(--size-2);
  align-items: center;
}

.positions-list,
.moves-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
}

.position-row,
.move-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-5);
  align-items: center;
}

.btn-inline {
  padding: var(--size-2) var(--size-5);
  background-color: var(--color-bg-gray);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-10);
}

.btn-inline:hover {
  background-color: #f0f0f0;
}

.hints-section {
  padding: var(--size-6);
  background-color: var(--color-bg-gray);
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.hints-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}

.hint-item {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  padding: var(--size-6);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.hint-header {
  display: flex;
  gap: var(--size-5);
  align-items: center;
}

.hint-dialogue,
.hint-marks {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
}

.feedback-groups {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}

.feedback-group {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  padding: var(--size-6);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.feedback-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.feedback-lines {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
}

.feedback-line {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
  padding: var(--size-5);
  background-color: var(--color-bg-gray);
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.feedback-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-5);
}

.feedback-text-row {
  display: flex;
  gap: var(--size-5);
  align-items: flex-start;
}

.feedback-text-row textarea {
  flex: 1;
}

.field-label {
  color: var(--color-fubuki-primary);
  font-weight: 600;
  font-size: 9px;
}
</style>
