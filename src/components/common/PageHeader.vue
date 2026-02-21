<script setup lang="ts">
import BackButton from "./BackButton.vue";
import SettingsControl from "./SettingsControl.vue";

defineProps<{
  title?: string;
  showBack?: boolean;
}>();

defineEmits<{
  back: [];
}>();
</script>

<template>
  <div class="page-header">
    <BackButton
      v-if="showBack"
      @back="$emit('back')"
    />
    <h1 tabindex="-1">
      <slot name="title">{{ title }}</slot>
    </h1>
    <slot name="right" />
    <SettingsControl />
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  gap: var(--size-20);
  margin-bottom: var(--size-24);
  position: relative;
}

.page-header h1 {
  font-size: var(--font-size-24);
  font-weight: bold;
  color: var(--color-text-primary);
  margin: 0;
  flex: 1;
}

.page-header h1:focus:not(:focus-visible) {
  outline: none;
}
</style>
