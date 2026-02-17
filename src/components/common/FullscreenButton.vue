<script setup lang="ts">
import { ref } from "vue";
import { useEventListener } from "@vueuse/core";
import FullscreenIcon from "@/assets/icons/fullscreen.svg?component";
import FullscreenExitIcon from "@/assets/icons/fullscreen_exit.svg?component";

const isSupported = document.fullscreenEnabled;
const isFullscreen = ref(Boolean(document.fullscreenElement));

useEventListener(document, "fullscreenchange", () => {
  isFullscreen.value = Boolean(document.fullscreenElement);
});

const toggle = async (): Promise<void> => {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
};
</script>

<template>
  <button
    v-if="isSupported"
    class="fullscreen-button"
    :aria-label="isFullscreen ? '全画面を終了' : '全画面表示'"
    @click="toggle"
  >
    <FullscreenExitIcon v-if="isFullscreen" />
    <FullscreenIcon v-else />
  </button>
</template>

<style scoped>
.fullscreen-button {
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
