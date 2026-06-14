<script setup lang="ts">
import InfoIcon from "@/assets/icons/info.svg?component";

defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    class="info-button"
    @click="$emit('click')"
  >
    <InfoIcon class="info-button__icon" />
    <span class="info-button__label">情報</span>
  </button>
</template>

<style scoped>
.info-button {
  width: var(--size-40);
  height: var(--size-40);
  padding: var(--size-3);
  background: rgba(255, 255, 255, 0.9);
  border: var(--size-2) solid var(--color-border);
  border-radius: var(--size-8);
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--size-2);

  &:hover {
    background: white;
    border-color: var(--color-border-heavy);
    color: var(--color-text-primary);
  }
}

.info-button__icon {
  display: block;
  width: var(--size-20);
  height: var(--size-20);
  flex-shrink: 0;
}

.info-button__label {
  font-size: var(--size-9);
  line-height: 1;
  font-weight: 500;
  white-space: nowrap;
}
</style>
