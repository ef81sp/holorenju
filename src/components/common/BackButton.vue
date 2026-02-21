<script setup lang="ts">
const emits = defineEmits<{
  back: [];
}>();
</script>

<template>
  <button
    class="back-button"
    aria-label="戻る"
    @click="emits('back')"
  >
    <span class="back-text-full">← 戻る</span>
    <span class="back-text-short">←</span>
  </button>
</template>

<style scoped>
.back-button {
  width: fit-content;
  padding: var(--size-6) var(--size-14);
  background: white;
  border: var(--size-2) solid var(--color-border);
  border-radius: var(--size-6);
  cursor: pointer;
  font-size: var(--font-size-14);
  font-weight: 500;
  white-space: nowrap;
  transition: all 0.2s;
}

.back-button:hover {
  background: var(--color-bg-gray);
  border-color: var(--color-primary);
}

.back-text-short {
  display: none;
}

@container (max-width: 100px) {
  .back-text-full {
    display: none;
  }

  .back-text-short {
    display: inline;
  }

  .back-button {
    padding: var(--size-6) var(--size-8);
  }
}
</style>
