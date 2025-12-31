<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "@/stores/appStore";
import MenuPage from "./pages/MenuPage.vue";
import DifficultyPage from "./pages/DifficultyPage.vue";
import ScenarioListPage from "./pages/ScenarioListPage.vue";
import ScenarioPlayer from "./scenarios/ScenarioPlayer.vue";

const appStore = useAppStore();

const currentScene = computed(() => appStore.scene);
const selectedScenarioId = computed(() => appStore.selectedScenarioId);

const handleComplete = (): void => {
  appStore.goToScenarioList();
};

const handleBack = (): void => {
  appStore.goToScenarioList();
};
</script>

<template>
  <div class="main-container">
    <MenuPage v-if="currentScene === 'menu'" />
    <DifficultyPage v-else-if="currentScene === 'difficulty'" />
    <ScenarioListPage v-else-if="currentScene === 'scenarioList'" />
    <ScenarioPlayer
      v-else-if="currentScene === 'scenarioPlay' && selectedScenarioId"
      :scenario-id="selectedScenarioId"
      @complete="handleComplete"
      @back="handleBack"
    />
  </div>
</template>

<style scoped>
.main-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
