<script setup lang="ts">
import { computed, type PropType } from "vue";

defineProps({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: "",
  },
  withDescription: {
    type: Boolean,
    default: true,
  },
});

defineEmits<{
  "update:title": [value: string];
  "update:description": [value: string];
}>();
</script>

<template>
  <div class="section-meta-editor">
    <div class="form-group">
      <label>セクションタイトル</label>
      <input
        :value="title"
        type="text"
        class="form-input"
        @input="
          $emit('update:title', ($event.target as HTMLInputElement).value)
        "
      />
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
