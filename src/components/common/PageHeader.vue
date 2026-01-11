<script setup lang="ts">
import SettingsControl from "./SettingsControl.vue";

defineProps<{
  title: string;
  showBack?: boolean;
}>();

defineEmits<{
  back: [];
}>();
</script>

<template>
  <div class="page-header">
    <button
      v-if="showBack"
      class="back-button"
      @click="$emit('back')"
    >
      ← 戻る
    </button>
    <h1>{{ title }}</h1>
    <slot name="right" />
    <SettingsControl />
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  gap: var(--size-20);
  margin-bottom: var(--size-40);
  position: relative;
}

.page-header h1 {
  font-size: var(--size-40);
  font-weight: bold;
  color: var(--color-text-primary);
  margin: 0;
  flex: 1;
}

.back-button {
  padding: var(--size-8) var(--size-16);
  background: rgba(255, 255, 255, 0.9);
  border: var(--size-2) solid #ddd;
  border-radius: var(--size-8);
  cursor: pointer;
  font-size: var(--size-14);
  font-weight: bold;
  transition: all 0.2s ease;
  white-space: nowrap;

  &:hover {
    background: white;
    border-color: #999;
  }
}
</style>
