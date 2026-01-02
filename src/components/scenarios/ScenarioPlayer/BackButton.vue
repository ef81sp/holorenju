<script setup lang="ts">
const emits = defineEmits<{
  back: [];
}>();
</script>

<template>
  <button
    class="back-button"
    @click="emits('back')"
  >
    ← 戻る
  </button>
</template>

<style scoped>
.back-button {
  width: fit-content;
  padding: var(--size-10) var(--size-20);
  background: white;
  border: 2px solid #ddd;
  border-radius: 8px;
  cursor: pointer;
  font-size: var(--size-16);
  font-weight: 500;
  transition: all 0.2s;
}

.back-button:hover {
  background: #f5f5f5;
  border-color: #4a9eff;
}
</style>
