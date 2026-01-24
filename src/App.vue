<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from "vue";
import MainView from "./components/MainView.vue";
import FullscreenPrompt from "./components/common/FullscreenPrompt.vue";
import { useFullscreenPrompt } from "./logic/useFullscreenPrompt";
import { usePreferencesStore } from "./stores/preferencesStore";

const fullscreenPromptRef = useTemplateRef<
  InstanceType<typeof FullscreenPrompt>
>("fullscreenPromptRef");

const { showFullscreenPrompt, handleNeverShow, isPromptDisabled, isMobile } =
  useFullscreenPrompt(fullscreenPromptRef);

// テキストサイズ設定をDOMに反映
const preferencesStore = usePreferencesStore();
watch(
  () => preferencesStore.textSize,
  (size) => {
    if (size === "normal") {
      document.documentElement.removeAttribute("data-text-size");
    } else {
      document.documentElement.dataset.textSize = size;
    }
  },
  { immediate: true },
);

// 演出速度倍率をCSS変数に反映
watch(
  () => preferencesStore.effectSpeedMultiplier,
  (multiplier) => {
    document.documentElement.style.setProperty(
      "--effect-speed-multiplier",
      String(multiplier),
    );
  },
  { immediate: true },
);

onMounted(() => {
  showFullscreenPrompt();
});
</script>

<template>
  <div id="app">
    <MainView />
    <FullscreenPrompt
      v-if="isMobile || isPromptDisabled()"
      ref="fullscreenPromptRef"
      @never-show="handleNeverShow"
    />
  </div>
</template>

<style>
#app {
  background: linear-gradient(
    135deg,
    var(--color-fubuki-bg-light) 0%,
    var(--color-miko-bg-light) 100%
  );
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
}
</style>
