<script setup lang="ts">
import type { PropType } from "vue";
import { useEditorStore } from "@/editor/stores/editorStore";
import DemoSectionEditor from "./DemoSectionEditor.vue";
import ProblemSectionEditor from "./ProblemSectionEditor.vue";

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
const handleAddSection = (type: "demo" | "problem"): void => {
  editorStore.addSection(type);
};

const handleRemoveSection = (index: number): void => {
  editorStore.removeSection(index);
};

const handleSelectSection = (index: number): void => {
  editorStore.selectSection(index);
};

const updateSectionId = (value: string): void => {
  if (editorStore.currentSection) {
    editorStore.updateCurrentSection({ id: value });
  }
};

const handleTypeChange = (type: "demo" | "problem"): void => {
  editorStore.changeCurrentSectionType(type);
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
          @click="() => handleAddSection('problem')"
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
              {{ section.type === "demo" ? "📖" : "❓" }}
            </span>
            <span class="section-title">{{ section.title }}</span>
            <span class="section-id">({{ section.id }})</span>
          </button>
          <button
            class="btn-delete"
            @click="handleRemoveSection(index)"
          >
            ✕
          </button>
        </div>
      </div>
    </template>

    <!-- セクション詳細編集 -->
    <template v-if="props.mode !== 'list'">
      <div
        v-if="editorStore.currentSection"
        class="section-detail"
      >
        <h3>セクション詳細: {{ editorStore.currentSection.title }}</h3>

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
              @input="
                (e) => updateSectionId((e.target as HTMLInputElement).value)
              "
            >
          </div>
          <div class="form-group">
            <label>タイプ</label>
            <select
              :value="editorStore.currentSection.type"
              class="form-input"
              @change="
                (e) =>
                  handleTypeChange(
                    (e.target as HTMLSelectElement).value as 'demo' | 'problem',
                  )
              "
            >
              <option value="demo">デモ</option>
              <option value="problem">問題</option>
            </select>
          </div>
        </div>

        <DemoSectionEditor
          v-if="editorStore.currentSection.type === 'demo'"
          :view="props.detailPart"
        />
        <ProblemSectionEditor
          v-else-if="editorStore.currentSection.type === 'problem'"
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
  gap: calc(var(--size-unit) * 0.8);
}

.section-actions {
  display: flex;
  gap: calc(var(--size-unit) * 0.4);
}

.btn-add {
  padding: calc(var(--size-unit) * 0.4) calc(var(--size-unit) * 0.8);
  background-color: var(--color-primary);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: calc(var(--size-unit) * 1.1);
  transition: opacity 0.2s;
}

.btn-add:hover {
  opacity: 0.9;
}

.empty-state {
  padding: calc(var(--size-unit) * 1.2);
  text-align: center;
  color: var(--color-text-secondary);
  background-color: var(--color-background-soft);
  border-radius: 3px;
  border: 1px dashed var(--color-border);
  font-size: calc(var(--size-unit) * 1.1);
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
  background-color: var(--color-background-soft);
}

.section-item-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: calc(var(--size-unit) * 0.5);
  padding: calc(var(--size-unit) * 0.5) calc(var(--size-unit) * 0.7);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: calc(var(--size-unit) * 1.1);
  transition: background-color 0.2s;
}

.section-item-content:hover {
  background-color: #f9f9f9;
}

.section-type {
  font-size: calc(var(--size-unit) * 1.4);
  min-width: calc(var(--size-unit) * 1.5);
}

.section-title {
  font-weight: 600;
  color: var(--color-text);
}

.section-id {
  font-size: calc(var(--size-unit) * 1);
  color: var(--color-text-secondary);
}

.btn-delete {
  padding: calc(var(--size-unit) * 0.5);
  background-color: #ff6b6b;
  border: none;
  cursor: pointer;
  font-size: calc(var(--size-unit) * 1.1);
  transition: opacity 0.2s;
}

.btn-delete:hover {
  opacity: 0.8;
}

.section-detail {
  padding: calc(var(--size-unit) * 0.8);
  background-color: white;
  border: 2px solid var(--color-primary);
  border-radius: 3px;
  margin-top: calc(var(--size-unit) * 0.6);
}

.section-detail h3 {
  margin-top: 0;
  margin-bottom: calc(var(--size-unit) * 0.8);
  font-size: calc(var(--size-unit) * 1.3);
  color: var(--color-primary);
}

.section-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: calc(var(--size-unit) * 0.6);
  margin-bottom: calc(var(--size-unit) * 0.8);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.3);
}

.form-group label {
  font-weight: 600;
  font-size: calc(var(--size-unit) * 1.1);
}

.form-input {
  padding: calc(var(--size-unit) * 0.3);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: calc(var(--size-unit) * 1.1);
  font-family: inherit;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.05);
}
</style>
