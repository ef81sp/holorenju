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
  gap: 2rem;
  position: relative;
  padding: 2rem;
}

.back-button {
  position: absolute;
  top: 2rem;
  left: 2rem;
  padding: 0.75rem 1.5rem;
  background: rgba(255, 255, 255, 0.9);
  border: 2px solid #ddd;
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 1rem;
  font-weight: bold;
  transition: all 0.2s ease;
}

.back-button:hover {
  background: white;
  border-color: #999;
  transform: translateX(-4px);
}

.title {
  font-size: 2.5rem;
  font-weight: bold;
  color: var(--primary-color, #333);
  margin: 0;
}

.difficulty-buttons {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: min(400px, 80%);
}

.difficulty-button {
  padding: 1.5rem 2rem;
  border: none;
  border-radius: 1rem;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

.difficulty-button:hover:not(:disabled) {
  transform: translateY(-4px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.difficulty-button:active:not(:disabled) {
  transform: translateY(-2px);
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
  gap: 1rem;
  position: relative;
}

.button-icon {
  font-size: 2rem;
}

.button-text {
  font-size: 1.5rem;
  font-weight: bold;
  color: #333;
}

.badge {
  position: absolute;
  right: -0.5rem;
  top: -0.5rem;
  background: #ff6b6b;
  color: white;
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.5rem;
  font-weight: bold;
}
</style>
