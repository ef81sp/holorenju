<script setup lang="ts">
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
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
>
      <circle
        cx="12"
        cy="12"
        r="10"
/>
      <line
        x1="12"
        y1="16"
        x2="12"
        y2="12"
/>
      <line
        x1="12"
        y1="8"
        x2="12.01"
        y2="8"
/>
    </svg>
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
    width: 100%;
    height: 100%;
  }
}
</style>
