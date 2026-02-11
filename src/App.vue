<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from "vue";
import MainView from "./components/MainView.vue";
import FullscreenPrompt from "./components/common/FullscreenPrompt.vue";
import AudioConfirmDialog from "./components/common/AudioConfirmDialog.vue";
import { useFullscreenPrompt } from "./logic/useFullscreenPrompt";
import { usePreferencesStore } from "./stores/preferencesStore";
import { useAudioStore } from "./stores/audioStore";

const fullscreenPromptRef = useTemplateRef<
  InstanceType<typeof FullscreenPrompt>
>("fullscreenPromptRef");

const audioConfirmRef =
  useTemplateRef<InstanceType<typeof AudioConfirmDialog>>("audioConfirmRef");

const { showFullscreenPrompt, handleNeverShow, isPromptDisabled, isMobile } =
  useFullscreenPrompt(fullscreenPromptRef);

// テキストサイズ設定をDOMに反映
const preferencesStore = usePreferencesStore();
const audioStore = useAudioStore();

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

/**
 * Audio確認ダイアログを表示（FullscreenPromptの後に表示）
 */
function showAudioConfirmIfNeeded(): void {
  if (preferencesStore.audioHasBeenAsked) {
    // 既に確認済み: 有効なら再生開始
    if (preferencesStore.audioEnabled) {
      audioStore.preloadSfx();
      audioStore.playBgm();
    }
    return;
  }
  audioConfirmRef.value?.showModal();
}

function handleAudioEnable(): void {
  preferencesStore.audioEnabled = true;
  preferencesStore.audioHasBeenAsked = true;
  audioStore.preloadSfx();
  audioStore.playBgm();
}

function handleAudioDisable(): void {
  preferencesStore.audioEnabled = false;
  preferencesStore.audioHasBeenAsked = true;
}

onMounted(() => {
  // モバイルでFullscreenPromptが表示される場合は、閉じた後にAudio確認
  if (isMobile.value && !isPromptDisabled()) {
    showFullscreenPrompt();
  } else {
    // デスクトップまたはFullscreenPrompt無効の場合は直接Audio確認
    showAudioConfirmIfNeeded();
  }
});
</script>

<template>
  <div id="app">
    <MainView />
    <FullscreenPrompt
      v-if="isMobile || isPromptDisabled()"
      ref="fullscreenPromptRef"
      @never-show="handleNeverShow"
      @fullscreen="showAudioConfirmIfNeeded"
      @close="showAudioConfirmIfNeeded"
    />
    <AudioConfirmDialog
      ref="audioConfirmRef"
      @enable="handleAudioEnable"
      @disable="handleAudioDisable"
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
