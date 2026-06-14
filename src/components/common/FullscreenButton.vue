<script setup lang="ts">
import { ref } from "vue";
import { useEventListener } from "@vueuse/core";
import IconButton from "./IconButton.vue";
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
  <IconButton
    v-if="isSupported"
    size="lg"
    variant="toolbar"
    :label="isFullscreen ? '画面縮小' : '全画面'"
    @click="toggle"
  >
    <FullscreenExitIcon v-if="isFullscreen" />
    <FullscreenIcon v-else />
  </IconButton>
</template>
