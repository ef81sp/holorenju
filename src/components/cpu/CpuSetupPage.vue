<script setup lang="ts">
/**
 * CPU対戦設定画面
 *
 * 難易度と先後手を選択してゲームを開始する
 */

import { ref } from "vue";

import PageHeader from "@/components/common/PageHeader.vue";
import { useAppStore } from "@/stores/appStore";
import type { CpuDifficulty } from "@/types/cpu";

const appStore = useAppStore();

// 選択状態
const selectedDifficulty = ref<CpuDifficulty>("medium");
const selectedFirst = ref(true);

interface DifficultyCard {
  key: CpuDifficulty;
  label: string;
  icon: string;
  description: string;
}

const difficultyCards: DifficultyCard[] = [
  {
    key: "beginner",
    label: "かんたん",
    icon: "🌱",
    description: "ゆっくり考えて練習したい人向け",
  },
  {
    key: "easy",
    label: "やさしい",
    icon: "⭐",
    description: "基本的な戦術を試せる難易度",
  },
  {
    key: "medium",
    label: "ふつう",
    icon: "🔥",
    description: "しっかり読まないと勝てない",
  },
  {
    key: "hard",
    label: "むずかしい",
    icon: "👑",
    description: "上級者向けの強さ",
  },
];

const handleSelectDifficulty = (difficulty: CpuDifficulty): void => {
  selectedDifficulty.value = difficulty;
};

const handleStartGame = (): void => {
  appStore.startCpuGame(selectedDifficulty.value, selectedFirst.value);
};

const handleBack = (): void => {
  appStore.goToMenu();
};
</script>

<template>
  <div class="cpu-setup-page">
    <PageHeader
      title="CPU対戦"
      show-back
      @back="handleBack"
    />
    <div class="content">
      <div class="setup-container">
        <!-- 難易度選択 -->
        <section class="setup-section">
          <h2 class="section-title">難易度を選択</h2>
          <div class="difficulty-grid">
            <button
              v-for="card in difficultyCards"
              :key="card.key"
              class="difficulty-card"
              :class="{ selected: selectedDifficulty === card.key }"
              @click="handleSelectDifficulty(card.key)"
            >
              <span class="card-icon">{{ card.icon }}</span>
              <span class="card-label">{{ card.label }}</span>
              <span class="card-description">{{ card.description }}</span>
            </button>
          </div>
        </section>

        <!-- 先後手選択 -->
        <section class="setup-section">
          <h2 class="section-title">先後手を選択</h2>
          <div class="order-buttons">
            <button
              class="order-button"
              :class="{ selected: selectedFirst }"
              @click="selectedFirst = true"
            >
              <span class="order-icon">●</span>
              <span class="order-label">先手（黒）</span>
              <span class="order-description">あなたから打ち始めます</span>
            </button>
            <button
              class="order-button"
              :class="{ selected: !selectedFirst }"
              @click="selectedFirst = false"
            >
              <span class="order-icon white">○</span>
              <span class="order-label">後手（白）</span>
              <span class="order-description">CPUから打ち始めます</span>
            </button>
          </div>
        </section>

        <!-- 開始ボタン -->
        <button
          class="start-button"
          @click="handleStartGame"
        >
          対戦開始
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cpu-setup-page {
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

.setup-container {
  display: flex;
  flex-direction: column;
  gap: var(--size-24);
  max-width: var(--size-500);
  width: 100%;
}

.setup-section {
  display: flex;
  flex-direction: column;
  gap: var(--size-12);
}

.section-title {
  font-size: var(--size-16);
  font-weight: 500;
  color: var(--color-text-primary);
  margin: 0;
}

.difficulty-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--size-12);
}

.difficulty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-6);
  padding: var(--size-16);
  background: var(--color-background-secondary);
  border: var(--size-2) solid transparent;
  border-radius: var(--size-12);
  cursor: pointer;
  transition: all 0.2s ease;
}

.difficulty-card:hover {
  transform: translateY(calc(-1 * var(--size-2)));
  box-shadow: 0 var(--size-4) var(--size-12) rgba(0, 0, 0, 0.15);
}

.difficulty-card.selected {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.card-icon {
  font-size: var(--size-24);
}

.card-label {
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-primary);
}

.card-description {
  font-size: var(--size-10);
  color: var(--color-text-secondary);
  text-align: center;
  line-height: 1.3;
}

.order-buttons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--size-12);
}

.order-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-8);
  padding: var(--size-20);
  background: var(--color-background-secondary);
  border: var(--size-2) solid transparent;
  border-radius: var(--size-12);
  cursor: pointer;
  transition: all 0.2s ease;
}

.order-button:hover {
  transform: translateY(calc(-1 * var(--size-2)));
  box-shadow: 0 var(--size-4) var(--size-12) rgba(0, 0, 0, 0.15);
}

.order-button.selected {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.order-icon {
  font-size: var(--size-32);
  line-height: 1;
}

.order-icon.white {
  color: #888;
}

.order-label {
  font-size: var(--size-16);
  font-weight: 500;
  color: var(--color-text-primary);
}

.order-description {
  font-size: var(--size-12);
  color: var(--color-text-secondary);
}

.start-button {
  padding: var(--size-16) var(--size-32);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: var(--size-12);
  font-size: var(--size-18);
  font-weight: 500;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
}

.start-button:hover {
  transform: translateY(calc(-1 * var(--size-2)));
  box-shadow: 0 var(--size-6) var(--size-16) rgba(0, 0, 0, 0.2);
}

.start-button:active {
  transform: translateY(0);
}
</style>
