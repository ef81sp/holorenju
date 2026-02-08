<script setup lang="ts">
import InfoIcon from "@/assets/icons/info.svg?component";

defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    class="info-button"
    aria-label="情報"
    @click="$emit('click')"
  >
    <InfoIcon />
  </button>
</template>

<style scoped>
.info-button {
  width: var(--size-40);
  height: var(--size-40);
  padding: var(--size-8);
  background: rgba(255, 255, 255, 0.9);
  border: var(--size-2) solid var(--color-border);
  border-radius: var(--size-8);
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text-secondary);

  &:hover {
    background: white;
    border-color: var(--color-border-heavy);
    color: var(--color-text-primary);
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    margin: auto;
  }
}
</style>
