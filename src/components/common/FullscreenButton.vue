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
    (
      screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      }
    )
      .lock?.("landscape")
      .catch(() => {
        /* unsupported */
      });
  }
};
</script>

<template>
  <button
    v-if="isSupported"
    class="fullscreen-button"
    @click="toggle"
  >
    <FullscreenExitIcon
      v-if="isFullscreen"
      class="fullscreen-button__icon"
    />
    <FullscreenIcon
      v-else
      class="fullscreen-button__icon"
    />
    <span class="fullscreen-button__label">
      {{ isFullscreen ? "画面縮小" : "全画面" }}
    </span>
  </button>
</template>

<style scoped>
.fullscreen-button {
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

.fullscreen-button__icon {
  display: block;
  width: var(--size-20);
  height: var(--size-20);
  flex-shrink: 0;
}

.fullscreen-button__label {
  /* 「画面縮小」が 40px ボタン枠に収まるよう他ボタン(9px)より小さく */
  font-size: var(--size-7);
  line-height: 1;
  font-weight: 500;
  white-space: nowrap;
}
</style>
