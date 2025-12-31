<script setup lang="ts">
import { computed } from "vue";
import { useAppStore, type Difficulty } from "@/stores/appStore";
import { useProgressStore } from "@/stores/progressStore";
import PageHeader from "@/components/common/PageHeader.vue";
import scenariosIndex from "@/data/scenarios/index.json";

const appStore = useAppStore();
const progressStore = useProgressStore();

// 各難易度の進捗計算
const getProgress = (difficulty: Difficulty) => {
  const difficultyData = scenariosIndex.difficulties[difficulty];
  const total = difficultyData.scenarios.length;
  const completed = difficultyData.scenarios.filter((scenario) =>
    progressStore.completedScenarios.includes(scenario.id),
  ).length;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, rate };
};

const beginnerProgress = computed(() => getProgress("beginner"));
const intermediateProgress = computed(() => getProgress("intermediate"));
const advancedProgress = computed(() => getProgress("advanced"));

const handleSelectDifficulty = (difficulty: Difficulty) => {
  appStore.selectDifficulty(difficulty);
};

const handleBack = () => {
  appStore.goToMenu();
};
</script>

<template>
  <div class="difficulty-page">
    <PageHeader
      title="難易度を選択"
      show-back
      @back="handleBack"
    />
    <div class="content">
      <div class="difficulty-buttons">
        <button
          class="difficulty-button"
          :style="{ background: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)' }"
          @click="handleSelectDifficulty('beginner')"
        >
          <div class="button-icon">🌱</div>
          <div class="button-text-area">
            <div class="button-text">入門</div>
            <p class="button-description">五目並べとの違いや、基本的なルールを学びます</p>
          </div>
          <div class="progress-info">
            <span class="progress-text">{{ beginnerProgress.completed }} / {{ beginnerProgress.total }}</span>
            <progress
              class="progress-bar"
              :value="beginnerProgress.rate"
              max="100"
            />
          </div>
        </button>
        <button
          class="difficulty-button"
          :style="{ background: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' }"
          @click="handleSelectDifficulty('intermediate')"
        >
          <div class="button-icon">⭐</div>
          <div class="button-text-area">
            <div class="button-text">初級</div>
            <p class="button-description">基本的な戦術や考え方を学びます</p>
          </div>
          <div class="progress-info">
            <span class="progress-text">{{ intermediateProgress.completed }} / {{ intermediateProgress.total }}</span>
            <progress
              class="progress-bar"
              :value="intermediateProgress.rate"
              max="100"
            />
          </div>
        </button>
        <button
          class="difficulty-button"
          :style="{ background: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)' }"
          @click="handleSelectDifficulty('advanced')"
        >
          <div class="button-icon">🔥</div>
          <div class="button-text-area">
            <div class="button-text">中級</div>
            <p class="button-description">実戦的な高度なテクニックを学びます</p>
          </div>
          <div class="progress-info">
            <span class="progress-text">{{ advancedProgress.completed }} / {{ advancedProgress.total }}</span>
            <progress
              class="progress-bar"
              :value="advancedProgress.rate"
              max="100"
            />
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.difficulty-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  padding: var(--size-40) var(--size-20);
  overflow-y: auto;
  box-sizing: border-box;
}

.content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.difficulty-buttons {
  display: flex;
  flex-direction: row;
  gap: var(--size-30);
  width: 100%;
  justify-content: center;
}

.difficulty-button {
  flex: 1;
  min-width: var(--size-150);
  padding: var(--size-20);
  border: var(--size-2) solid var(--color-border-heavy);
  border-radius: var(--size-16);
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 var(--size-5) var(--size-16) rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-12);
  position: relative;
}

.difficulty-button:hover:not(:disabled) {
  transform: translateY(calc(-1 * var(--size-5)));
  box-shadow: 0 var(--size-8) var(--size-20) rgba(0, 0, 0, 0.2);
}

.difficulty-button:active:not(:disabled) {
  transform: translateY(calc(-1 * var(--size-2)));
}

.difficulty-button.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: linear-gradient(135deg, #ddd 0%, #bbb 100%) !important;
}

.button-icon {
  font-size: var(--size-32);
}

.button-text-area {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  text-align: center;
}

.button-text {
  font-size: var(--size-32);
  font-weight: bold;
  color: #333;
}

.button-description {
  font-size: var(--size-12);
  color: #666;
  margin: 0;
  padding: 0;
  line-height: 1.4;
  word-break: auto-phrase;
}

.progress-info {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  width: 100%;
  margin-top: var(--size-8);
}

.progress-text {
  font-size: var(--size-12);
  color: #666;
  text-align: center;
  font-weight: 600;
}

.progress-bar {
  width: 100%;
  height: var(--size-8);
  border-radius: var(--size-4);
  overflow: hidden;
  appearance: none;
  -webkit-appearance: none;
}

.progress-bar::-webkit-progress-bar {
  background: rgba(0, 0, 0, 0.1);
  border-radius: var(--size-4);
}

.progress-bar::-webkit-progress-value {
  background: var(--gradient-accent);
  border-radius: var(--size-4);
  transition: width 0.3s ease;
}

.progress-bar::-moz-progress-bar {
  background: var(--gradient-accent);
  border-radius: var(--size-4);
  transition: width 0.3s ease;
}

.badge {
  position: absolute;
  right: var(--size-8);
  top: var(--size-8);
  background: #ff6b6b;
  color: white;
  font-size: var(--size-12);
  padding: var(--size-5) var(--size-8);
  border-radius: var(--size-8);
  font-weight: bold;
}
</style>
