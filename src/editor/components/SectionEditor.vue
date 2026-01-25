<script setup lang="ts">
import type { PropType } from "vue";
import { useEditorStore } from "@/editor/stores/editorStore";
import DemoSectionEditor from "./DemoSectionEditor.vue";
import QuestionSectionEditor from "./QuestionSectionEditor.vue";

const editorStore = useEditorStore();

const props = defineProps({
  mode: {
    type: String as PropType<"full" | "list" | "detail">,
    default: "full",
  },
  detailPart: {
    type: String as PropType<"full" | "meta" | "content">,
    default: "full",
  },
});

// Methods
const handleAddSection = (type: "demo" | "question"): void => {
  editorStore.addSection(type);
};

const handleRemoveSection = (index: number): void => {
  editorStore.removeSection(index);
};

const handleMoveSectionUp = (index: number): void => {
  editorStore.moveSectionUp(index);
};

const handleMoveSectionDown = (index: number): void => {
  editorStore.moveSectionDown(index);
};

const handleSelectSection = (index: number): void => {
  editorStore.selectSection(index);
};

const handleTypeChange = (type: "demo" | "question"): void => {
  editorStore.changeCurrentSectionType(type);
};

const canMergeSections = (index: number): boolean => {
  const { sections } = editorStore.scenario;
  if (index < 0 || index >= sections.length - 1) {
    return false;
  }
  const current = sections[index];
  const next = sections[index + 1];
  return current?.type === "demo" && next?.type === "demo";
};

const handleMergeSections = (index: number): void => {
  editorStore.mergeDemoSections(index);
};
</script>

<template>
  <div
    class="section-editor"
    :class="[`mode-${props.mode}`]"
  >
    <template v-if="props.mode !== 'detail'">
      <!-- セクション追加ボタン -->
      <div class="section-actions">
        <button
          class="btn-add"
          @click="() => handleAddSection('demo')"
        >
          ➕ デモ
        </button>
        <button
          class="btn-add"
          @click="() => handleAddSection('question')"
        >
          ➕ 問題
        </button>
      </div>

      <!-- セクションリスト -->
      <div
        v-if="editorStore.scenario.sections.length === 0"
        class="empty-state"
      >
        セクションがありません。上のボタンから追加してください。
      </div>

      <div
        v-else
        class="sections-list"
      >
        <div
          v-for="(section, index) in editorStore.scenario.sections"
          :key="section.id"
          class="section-item"
          :class="{ active: editorStore.selectedSectionIndex === index }"
        >
          <button
            class="section-item-content"
            @click="handleSelectSection(index)"
          >
            <span
              class="section-type"
              :class="section.type"
            >
              {{ section.type === "demo" ? "📖 デモ" : "❓ 問題" }}
            </span>
            <span class="section-title">（{{ section.title }}）</span>
          </button>
          <div class="section-actions-buttons">
            <button
              v-if="canMergeSections(index)"
              class="btn-merge"
              title="次のデモセクションと統合"
              @click="handleMergeSections(index)"
            >
              ⊕
            </button>
            <button
              class="btn-move"
              :disabled="index === 0"
              title="上に移動"
              @click="handleMoveSectionUp(index)"
            >
              ▲
            </button>
            <button
              class="btn-move"
              :disabled="index === editorStore.scenario.sections.length - 1"
              title="下に移動"
              @click="handleMoveSectionDown(index)"
            >
              ▼
            </button>
            <button
              class="btn-delete"
              title="削除"
              @click="handleRemoveSection(index)"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- セクション詳細編集 -->
    <template v-if="props.mode !== 'list'">
      <div
        v-if="editorStore.currentSection"
        class="section-detail"
      >
        <h2>セクション詳細: {{ editorStore.currentSection.title }}</h2>

        <div
          v-if="props.detailPart !== 'content'"
          class="section-meta"
        >
          <div class="form-group">
            <label>セクションID</label>
            <input
              type="text"
              :value="editorStore.currentSection.id"
              class="form-input"
              disabled
              readonly
              title="セクションIDは自動採番されます（読み取り専用）"
            />
          </div>
          <div class="form-group">
            <label>タイプ</label>
            <select
              :value="editorStore.currentSection.type"
              class="form-input"
              @change="
                (e) =>
                  handleTypeChange(
                    (e.target as HTMLSelectElement).value as
                      | 'demo'
                      | 'question',
                  )
              "
            >
              <option value="demo">デモ</option>
              <option value="question">問題</option>
            </select>
          </div>
        </div>

        <DemoSectionEditor
          v-if="editorStore.currentSection.type === 'demo'"
          :view="props.detailPart"
        />
        <QuestionSectionEditor
          v-else-if="editorStore.currentSection.type === 'question'"
          :view="props.detailPart"
        />
      </div>
      <div
        v-else
        class="empty-state"
      >
        セクションを選択してください。
      </div>
    </template>
  </div>
</template>

<style scoped>
.section-editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
}

.section-actions {
  display: flex;
  gap: var(--size-5);
}

.btn-add {
  padding: var(--size-5) var(--size-8);
  background-color: #4a90e2;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-12);
  transition: opacity 0.2s;
}

.btn-add:hover {
  opacity: 0.9;
}

.empty-state {
  padding: var(--size-12);
  text-align: center;
  color: var(--color-text-secondary);
  background-color: var(--color-bg-gray);
  border-radius: 3px;
  border: 1px dashed var(--color-border);
  font-size: var(--size-12);
}

.sections-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  overflow: hidden;
}

.section-item {
  display: flex;
  gap: 0;
  background-color: white;
  border-bottom: 1px solid var(--color-border);
  transition: background-color 0.2s;
}

.section-item:last-child {
  border-bottom: none;
}

.section-item.active {
  background-color: var(--color-bg-gray);
}

.section-item-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--size-5);
  padding: var(--size-5) var(--size-6);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: var(--size-12);
  transition: background-color 0.2s;
}

.section-item-content:hover {
  background-color: #f9f9f9;
}

.section-type {
  font-size: var(--size-14);
  min-width: var(--size-16);
}

.section-title {
  font-weight: 600;
  color: var(--color-text);
}

.section-actions-buttons {
  display: flex;
  gap: 0;
}

.btn-move {
  padding: var(--size-5);
  background-color: #4a90e2;
  border: none;
  cursor: pointer;
  font-size: var(--size-10);
  transition: opacity 0.2s;
  min-width: var(--size-24);
}

.btn-move:hover:not(:disabled) {
  opacity: 0.8;
}

.btn-move:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.btn-delete {
  padding: var(--size-5);
  background-color: #ff6b6b;
  border: none;
  cursor: pointer;
  font-size: var(--size-12);
  transition: opacity 0.2s;
}

.btn-delete:hover {
  opacity: 0.8;
}

.btn-merge {
  padding: var(--size-5);
  background-color: #4caf50;
  border: none;
  cursor: pointer;
  font-size: var(--size-12);
  transition: opacity 0.2s;
  min-width: var(--size-24);
}

.btn-merge:hover {
  opacity: 0.8;
}

.section-detail {
  padding: var(--size-8);
  background-color: white;
  border: 2px solid #4a90e2;
  border-radius: 3px;
  margin-top: var(--size-6);
}

.section-detail h3 {
  margin-top: 0;
  margin-bottom: var(--size-8);
  font-size: var(--size-14);
  color: #4a90e2;
}

.section-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--size-6);
  margin-bottom: var(--size-8);
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

.form-input {
  padding: var(--size-2);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: var(--size-12);
  font-family: inherit;
}

.form-input:focus {
  outline: none;
  border-color: #4a90e2;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.05);
}
</style>
