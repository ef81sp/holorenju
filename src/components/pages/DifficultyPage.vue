<script setup lang="ts">
import { useAppStore, type Difficulty } from "@/stores/appStore";
import scenariosIndex from "@/data/scenarios/index.json";

const appStore = useAppStore();

interface DifficultyInfo {
  key: Difficulty;
  label: string;
  icon: string;
  enabled: boolean;
  color: string;
}

const difficulties: DifficultyInfo[] = [
  {
    key: "beginner",
    label: scenariosIndex.difficulties.beginner.label,
    icon: "🌱",
    enabled: true,
    color: "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)",
  },
  {
    key: "intermediate",
    label: scenariosIndex.difficulties.intermediate.label,
    icon: "⭐",
    enabled: true,
    color: "linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)",
  },
  {
    key: "advanced",
    label: scenariosIndex.difficulties.advanced.label,
    icon: "🔥",
    enabled: true,
    color: "linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)",
  },
];

const handleSelectDifficulty = (difficulty: Difficulty) => {
  appStore.selectDifficulty(difficulty);
};

const handleBack = () => {
  appStore.goToMenu();
};
</script>

<template>
  <div class="difficulty-page">
    <button
      class="back-button"
      @click="handleBack"
    >
      ← 戻る
    </button>
    <h1 class="title">難易度を選択</h1>
    <div class="difficulty-buttons">
      <button
        v-for="diff in difficulties"
        :key="diff.key"
        class="difficulty-button"
        :class="{ disabled: !diff.enabled }"
        :disabled="!diff.enabled"
        :style="{ background: diff.color }"
        @click="handleSelectDifficulty(diff.key)"
      >
        <div class="button-content">
          <span class="button-icon">{{ diff.icon }}</span>
          <span class="button-text">{{ diff.label }}</span>
          <span
            v-if="!diff.enabled"
            class="badge"
          >未実装</span>
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.difficulty-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  gap: var(--size-32);
  position: relative;
  padding: var(--size-32);
}

.back-button {
  position: absolute;
  top: var(--size-32);
  left: var(--size-32);
  padding: var(--size-12) var(--size-24);
  background: rgba(255, 255, 255, 0.9);
  border: var(--size-2) solid #ddd;
  border-radius: var(--size-8);
  cursor: pointer;
  font-size: var(--size-16);
  font-weight: bold;
  transition: all 0.2s ease;
}

.back-button:hover {
  background: white;
  border-color: #999;
  transform: translateX(calc(-1 * var(--size-5)));
}

.title {
  font-size: var(--size-40);
  font-weight: bold;
  color: var(--primary-color, #333);
  margin: 0;
}

.difficulty-buttons {
  display: flex;
  flex-direction: column;
  gap: var(--size-24);
  width: min(var(--size-500), 80%);
}

.difficulty-button {
  padding: var(--size-24) var(--size-32);
  border: none;
  border-radius: var(--size-16);
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 var(--size-5) var(--size-16) rgba(0, 0, 0, 0.1);
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

.button-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--size-16);
  position: relative;
}

.button-icon {
  font-size: var(--size-32);
}

.button-text {
  font-size: var(--size-24);
  font-weight: bold;
  color: #333;
}

.badge {
  position: absolute;
  right: calc(-1 * var(--size-8));
  top: calc(-1 * var(--size-8));
  background: #ff6b6b;
  color: white;
  font-size: var(--size-12);
  padding: var(--size-5) var(--size-8);
  border-radius: var(--size-8);
  font-weight: bold;
}
</style>
