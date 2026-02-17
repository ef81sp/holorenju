<script setup lang="ts">
/**
 * デバッグ用：シナリオを再読み込みするボタン
 */
import { inject } from "vue";
import { useScenarioReload } from "./composables/useScenarioReload";
import { scenarioNavKey } from "./composables/useScenarioNavProvide";

const isDev = import.meta.env.DEV;

// 親コンポーネントから loadScenario を inject
const scenarioNavContext = inject(scenarioNavKey);

const { reload } = scenarioNavContext
  ? useScenarioReload(scenarioNavContext.loadScenario)
  : { reload: () => Promise.resolve() };
</script>

<template>
  <button
    v-if="isDev"
    class="debug-reload-btn"
    title="シナリオを再読み込み（デバッグ用）"
    @click="reload"
  >
    🔃
  </button>
</template>

<style scoped>
.debug-reload-btn {
  padding: var(--size-4) var(--size-8);
  background-color: rgba(255, 200, 100, 0.8);
  border: 1px dashed var(--color-border);
  border-radius: var(--size-4);
  cursor: pointer;
  font-size: var(--size-14);
  transition: background-color 0.2s;
}

.debug-reload-btn:hover {
  background-color: rgba(255, 200, 100, 1);
}
</style>
