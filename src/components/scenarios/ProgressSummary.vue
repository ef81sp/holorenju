<script setup lang="ts">
import { useProgressStore } from "@/stores/progressStore";
import { computed } from "vue";

// Props
const props = defineProps<{
  totalScenarios: number;
}>();

// Store
const progressStore = useProgressStore();

// Computed
const completedCount = computed(() => progressStore.completedScenarios.length);
const totalScore = computed(() => progressStore.totalScore);
const completionRate = computed(() => progressStore.completionRate);
</script>

<template>
  <div class="progress-summary">
    <div class="progress-items">
      <div class="progress-item">
        <span class="label">完了:</span>
        <span class="value">{{ completedCount }} / {{ totalScenarios }}</span>
      </div>
      <div class="progress-item">
        <span class="label">スコア:</span>
        <span class="value">{{ totalScore }}点</span>
      </div>
    </div>
    <progress
      class="progress-bar"
      :value="completionRate"
      max="100"
    />
  </div>
</template>

<style scoped>
.progress-summary {
  padding: var(--size-16);
  background: var(--color-block-bg);
  border-radius: 12px;
  backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--size-12);
  height: 100%;
}

.progress-items {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--size-16);
  line-height: 1.6;
}

.progress-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-4);
  font-size: var(--size-14);
}

.progress-item .label {
  opacity: 0.9;
}

.progress-item .value {
  font-weight: 500;
}

.progress-bar {
  width: 100%;
  height: var(--size-10);
  border-radius: 4px;
  overflow: hidden;
  appearance: none;
  -webkit-appearance: none;
}

.progress-bar::-webkit-progress-bar {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.progress-bar::-webkit-progress-value {
  background: var(--gradient-accent);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-bar::-moz-progress-bar {
  background: var(--gradient-accent);
  border-radius: 4px;
  transition: width 0.3s ease;
}
</style>
