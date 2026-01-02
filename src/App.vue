<script setup lang="ts">
import { onMounted, useTemplateRef } from "vue";
import MainView from "./components/MainView.vue";
import FullscreenPrompt from "./components/common/FullscreenPrompt.vue";
import { useFullscreenPrompt } from "./logic/useFullscreenPrompt";

const fullscreenPromptRef = useTemplateRef<typeof FullscreenPrompt>(
  "fullscreenPromptRef",
);

const { showFullscreenPrompt, handleNeverShow, isPromptDisabled, isMobile } =
  useFullscreenPrompt(
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any 解決できないよ〜〜〜
    fullscreenPromptRef as any,
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
