<script setup lang="ts">
import { useEditorStore } from "@/editor/stores/editorStore";

const editorStore = useEditorStore();
</script>

<template>
  <div class="validation-panel">
    <div class="validation-header">
      <h3>⚠️ バリデーションエラー</h3>
      <p class="error-count">
        {{ editorStore.validationErrors.length }} 件のエラーが見つかりました
      </p>
    </div>

    <div class="errors-list">
      <div
        v-for="(error, index) in editorStore.validationErrors"
        :key="index"
        class="error-item"
      >
        <div class="error-path">{{ error.path }}</div>
        <div class="error-message">{{ error.message }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.validation-panel {
  margin: 0;
  padding: calc(var(--size-unit) * 0.6);
  background-color: #fff3cd;
  border: 2px solid #ffc107;
  border-radius: 3px;
  box-shadow: 0 2px 4px rgba(255, 193, 7, 0.2);
}

.validation-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: calc(var(--size-unit) * 0.5);
  padding-bottom: calc(var(--size-unit) * 0.3);
  border-bottom: 1px solid #ffc107;
}

.validation-header h3 {
  margin: 0;
  font-size: calc(var(--size-unit) * 1.2);
  color: #856404;
}

.error-count {
  margin: 0;
  font-size: calc(var(--size-unit) * 1);
  color: #856404;
  font-weight: 600;
}

.errors-list {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.4);
  max-height: calc(var(--size-unit) * 25);
  overflow-y: auto;
}

.error-item {
  padding: calc(var(--size-unit) * 0.5);
  background-color: rgba(255, 255, 255, 0.7);
  border-left: 3px solid #dc3545;
  border-radius: 3px;
}

.error-path {
  font-family: monospace;
  font-size: calc(var(--size-unit) * 1);
  color: #dc3545;
  font-weight: 600;
  margin-bottom: calc(var(--size-unit) * 0.2);
}

.error-message {
  font-size: calc(var(--size-unit) * 1);
  color: #856404;
  line-height: 1.4;
}
</style>
