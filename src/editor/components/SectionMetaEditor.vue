<script setup lang="ts">
import { computed } from "vue";
import { useEditorStore } from "@/editor/stores/editorStore";
import { TITLE_MAX_LENGTH } from "@/logic/scenarioFileHandler";

const props = defineProps<{
  title: string;
  description?: string;
  withDescription?: boolean;
  sectionIndex: number;
}>();

defineEmits<{
  "update:title": [value: string];
  "update:description": [value: string];
}>();

const editorStore = useEditorStore();

// タイトルの文字数カウント
const titleCharCount = computed(() => props.title.length);
const isTitleOver = computed(() => titleCharCount.value > TITLE_MAX_LENGTH);

// タイトルのバリデーションエラー
const titleError = computed(() => {
  const errorPath = `sections[${props.sectionIndex}].title`;
  return editorStore.validationErrors.find((e) => e.path === errorPath);
});
</script>

<template>
  <div class="section-meta-editor">
    <div class="form-group">
      <div class="label-row">
        <label>セクションタイトル</label>
        <span
          class="char-counter"
          :class="{ 'char-counter--over': isTitleOver }"
        >
          {{ titleCharCount }}/{{ TITLE_MAX_LENGTH }}
        </span>
      </div>
      <input
        :value="title"
        type="text"
        class="form-input"
        :class="{ 'input-error': isTitleOver }"
        @input="
          $emit('update:title', ($event.target as HTMLInputElement).value)
        "
      />
      <span
        v-if="titleError"
        class="inline-error"
      >
        {{ titleError.message }}
      </span>
    </div>
    <div
      v-if="withDescription"
      class="form-group"
    >
      <label>説明</label>
      <textarea
        :value="description"
        class="form-textarea"
        rows="4"
        @input="
          $emit(
            'update:description',
            ($event.target as HTMLTextAreaElement).value,
          )
        "
      />
    </div>
  </div>
</template>

<style scoped>
.section-meta-editor {
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

.form-input {
  padding: var(--input-padding);
  border: var(--border-input);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-base);
  font-family: inherit;

  &:focus {
    outline: none;
    border-color: var(--border-focus);
    box-shadow: var(--shadow-focus);
  }

  &.input-error {
    border-color: var(--color-error);
  }
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--size-4);
}

.label-row .char-counter {
  margin-top: 0;
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
