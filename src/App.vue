<script setup lang="ts">
import { ref } from "vue";

import ScenarioMenu from "./components/scenarios/ScenarioMenu.vue";
import ScenarioPlayer from "./components/scenarios/ScenarioPlayer.vue";

// State
type Screen = "menu" | "playing";

const currentScreen = ref<Screen>("menu");
const selectedScenario = ref<string | null>(null);

// Methods
const handleSelectScenario = (scenarioId: string): void => {
  selectedScenario.value = scenarioId;
  currentScreen.value = "playing";
};

const handleComplete = (): void => {
  currentScreen.value = "menu";
  selectedScenario.value = null;
};

const handleBack = (): void => {
  currentScreen.value = "menu";
  selectedScenario.value = null;
};
</script>

<template>
  <div id="app">
    <!-- シナリオメニュー画面 -->
    <ScenarioMenu
      v-if="currentScreen === 'menu'"
      @select-scenario="handleSelectScenario"
    />

    <!-- シナリオプレイ画面 -->
    <ScenarioPlayer
      v-else-if="currentScreen === 'playing' && selectedScenario"
      :scenario-id="selectedScenario"
      @complete="handleComplete"
      @back="handleBack"
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
