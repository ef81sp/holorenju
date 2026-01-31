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
        <fieldset class="setup-section">
          <legend class="section-title">難易度を選択</legend>
          <div class="difficulty-grid">
            <label
              v-for="card in difficultyCards"
              :key="card.key"
              class="difficulty-card"
            >
              <input
                v-model="selectedDifficulty"
                type="radio"
                name="difficulty"
                :value="card.key"
                class="visually-hidden"
              />
              <span class="card-icon">{{ card.icon }}</span>
              <span class="card-label">{{ card.label }}</span>
              <span class="card-description">{{ card.description }}</span>
            </label>
          </div>
        </fieldset>

        <!-- 先後手選択 -->
        <fieldset class="setup-section">
          <legend class="section-title">先後手を選択</legend>
          <div class="order-buttons">
            <label class="order-button">
              <input
                v-model="selectedFirst"
                type="radio"
                name="player-order"
                :value="true"
                class="visually-hidden"
              />
              <span class="order-icon">●</span>
              <div class="order-text">
                <span class="order-label">先手（黒）</span>
                <span class="order-description">あなたから打ち始めます</span>
              </div>
            </label>
            <label class="order-button">
              <input
                v-model="selectedFirst"
                type="radio"
                name="player-order"
                :value="false"
                class="visually-hidden"
              />
              <span class="order-icon white">○</span>
              <div class="order-text">
                <span class="order-label">後手（白）</span>
                <span class="order-description">CPUから打ち始めます</span>
              </div>
            </label>
          </div>
        </fieldset>

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
  padding: var(--size-24) var(--size-20);
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
  gap: var(--size-16);
  max-width: var(--size-600);
  width: 100%;
}

.setup-section {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
  border: none;
  padding: 0;
  margin: 0;
}

.section-title {
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-primary);
  padding: 0;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.difficulty-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--size-8);
}

.difficulty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-4);
  padding: var(--size-10) var(--size-8);
  background: var(--color-background-secondary);
  border: var(--size-2) solid transparent;
  border-radius: var(--size-10);
  cursor: pointer;
  transition: all 0.2s ease;
}

.difficulty-card:hover {
  transform: translateY(calc(-1 * var(--size-2)));
  box-shadow: 0 var(--size-4) var(--size-12) rgba(0, 0, 0, 0.15);
}

.difficulty-card:has(input:checked) {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.difficulty-card:has(input:focus-visible) {
  outline: var(--size-2) solid var(--color-primary);
  outline-offset: var(--size-2);
}

.card-icon {
  font-size: var(--size-20);
}

.card-label {
  font-size: var(--size-12);
  font-weight: 500;
  color: var(--color-text-primary);
}

.card-description {
  font-size: var(--size-8);
  color: var(--color-text-secondary);
  text-align: center;
  line-height: 1.3;
}

.order-buttons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--size-8);
}

.order-button {
  display: flex;
  align-items: center;
  gap: var(--size-10);
  padding: var(--size-10) var(--size-16);
  background: var(--color-background-secondary);
  border: var(--size-2) solid transparent;
  border-radius: var(--size-10);
  cursor: pointer;
  transition: all 0.2s ease;
}

.order-button:hover {
  transform: translateY(calc(-1 * var(--size-2)));
  box-shadow: 0 var(--size-4) var(--size-12) rgba(0, 0, 0, 0.15);
}

.order-button:has(input:checked) {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.order-button:has(input:focus-visible) {
  outline: var(--size-2) solid var(--color-primary);
  outline-offset: var(--size-2);
}

.order-icon {
  font-size: var(--size-24);
  line-height: 1;
  flex-shrink: 0;
}

.order-icon.white {
  color: #888;
}

.order-text {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
  text-align: left;
}

.order-label {
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-primary);
}

.order-description {
  font-size: var(--size-10);
  color: var(--color-text-secondary);
}

.start-button {
  padding: var(--size-12) var(--size-24);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: var(--size-10);
  font-size: var(--size-16);
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
