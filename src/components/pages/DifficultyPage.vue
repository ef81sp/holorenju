<script setup lang="ts">
import { computed, onMounted } from "vue";

import PageHeader from "@/components/common/PageHeader.vue";
import { useAppStore } from "@/stores/appStore";
import { useProgressStore } from "@/stores/progressStore";
import { useScenarioIndexStore } from "@/stores/scenarioIndexStore";
import type { ScenarioDifficulty } from "@/types/scenario";

const appStore = useAppStore();
const progressStore = useProgressStore();
const indexStore = useScenarioIndexStore();

onMounted(async () => {
  await indexStore.loadIndex();
});

interface ProgressInfo {
  completed: number;
  total: number;
  rate: number;
}

interface DifficultyCard {
  key: ScenarioDifficulty;
  label: string;
  gradient: string;
  description: string;
}

const difficultyCards: DifficultyCard[] = [
  {
    key: "gomoku_beginner",
    label: "五目並べ:入門",
    gradient: "var(--gradient-difficulty-1)",
    description: "五目並べの遊び方と連珠との違いからスタート",
  },
  {
    key: "gomoku_intermediate",
    label: "五目並べ:初級",
    gradient: "var(--gradient-difficulty-2)",
    description: "五目並べの基本戦術をひと通り固めるステップ",
  },
  {
    key: "renju_beginner",
    label: "連珠:入門",
    gradient: "var(--gradient-difficulty-3)",
    description: "禁手ルールや連珠ならではの基礎を確認",
  },
  {
    key: "renju_intermediate",
    label: "連珠:初級",
    gradient: "var(--gradient-difficulty-4)",
    description: "基本形の活用や攻守の組み立てを学ぶ",
  },
  {
    key: "renju_advanced",
    label: "連珠:中級",
    gradient: "var(--gradient-difficulty-5)",
    description: "実戦を意識した応用手筋と読みの強化",
  },
  {
    key: "renju_expert",
    label: "連珠:上級",
    gradient: "var(--gradient-difficulty-6)",
    description: "終盤力と緻密な布石運びで頂点を目指す",
  },
];

const getProgress = (difficulty: ScenarioDifficulty): ProgressInfo => {
  const difficultyData = indexStore.index?.difficulties[difficulty];
  const total = difficultyData?.scenarios.length ?? 0;
  const completed =
    difficultyData?.scenarios.filter((scenario) =>
      progressStore.completedScenarios.includes(scenario.id),
    ).length ?? 0;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, rate };
};

const progressByDifficulty = computed(() =>
  difficultyCards.reduce(
    (acc, card) => {
      acc[card.key] = getProgress(card.key);
      return acc;
    },
    {} as Record<ScenarioDifficulty, ProgressInfo>,
  ),
);

const handleSelectDifficulty = (difficulty: ScenarioDifficulty): void => {
  appStore.selectDifficulty(difficulty);
};

const handleBack = (): void => {
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
      <!-- ローディング表示 -->
      <div
        v-if="indexStore.isLoading"
        class="loading"
      >
        読み込み中...
      </div>

      <!-- エラー表示 -->
      <div
        v-else-if="indexStore.error"
        class="error"
      >
        {{ indexStore.error }}
      </div>

      <div
        v-else
        class="difficulty-grid"
      >
        <button
          v-for="(card, index) in difficultyCards"
          :key="card.key"
          class="difficulty-card"
          :class="{ 'difficulty-card--renju': card.key.startsWith('renju') }"
          :style="{ background: card.gradient }"
          @click="handleSelectDifficulty(card.key)"
        >
          <div class="card-header">
            <span class="card-ordinal">{{ index + 1 }}</span>
            <span class="card-label">{{ card.label }}</span>
          </div>
          <p class="card-description">{{ card.description }}</p>
          <div class="progress-info">
            <span class="progress-text">
              {{ progressByDifficulty[card.key]?.completed ?? 0 }} /
              {{ progressByDifficulty[card.key]?.total ?? 0 }}
            </span>
            <progress
              class="progress-bar"
              :value="progressByDifficulty[card.key]?.rate ?? 0"
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

.loading,
.error {
  font-size: var(--font-size-20);
  color: var(--color-text-secondary);
  text-align: center;
}

.error {
  color: var(--color-error);
}

.difficulty-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(2, 1fr);
  gap: var(--size-20);
  width: 100%;
  max-width: 1200px;
  align-content: center;
}

.difficulty-card {
  padding: var(--size-20);
  border: var(--size-2) solid var(--color-border-heavy);
  border-radius: var(--size-16);
  cursor: pointer;
  transition:
    transform 0.25s ease,
    box-shadow 0.25s ease;
  box-shadow: 0 var(--size-5) var(--size-16) rgba(0, 0, 0, 0.1);
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: var(--size-12);
  align-items: start;
  text-align: left;
}

.difficulty-card:hover {
  transform: translateY(calc(-1 * var(--size-5)));
  box-shadow: 0 var(--size-10) var(--size-24) rgba(0, 0, 0, 0.2);
}

.difficulty-card:active {
  transform: translateY(calc(-1 * var(--size-2)));
}

.card-header {
  display: flex;
  align-items: center;
  gap: var(--size-10);
  font-weight: 700;
  font-size: var(--font-size-18);
  color: var(--color-text-primary);
}

.card-ordinal {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--size-28);
  height: var(--size-28);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.7);
  font-size: var(--font-size-14);
  font-weight: 700;
  flex-shrink: 0;
}

.card-label {
  line-height: 1.3;
  flex: 1;
}

.card-description {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.5;
  font-size: var(--font-size-12);
}

.progress-info {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
}

.progress-text {
  font-size: var(--font-size-12);
  color: var(--color-text-primary);
  font-weight: 600;
}

.progress-bar {
  width: 100%;
  height: var(--size-8);
  border-radius: var(--size-6);
  overflow: hidden;
  appearance: none;
  -webkit-appearance: none;
  background: rgba(0, 0, 0, 0.1);
}

.progress-bar::-webkit-progress-bar {
  background: rgba(255, 255, 255, 0.35);
  border-radius: var(--size-6);
}

.progress-bar::-webkit-progress-value {
  background: rgba(17, 24, 39, 0.7);
  border-radius: var(--size-6);
  transition: width 0.3s ease;
}

.progress-bar::-moz-progress-bar {
  background: rgba(17, 24, 39, 0.7);
  border-radius: var(--size-6);
  transition: width 0.3s ease;
}

/* 連珠カード用スタイル（白文字） */
.difficulty-card--renju .card-header {
  color: #ffffff;
}

.difficulty-card--renju .card-ordinal {
  background: rgba(255, 255, 255, 0.25);
  color: rgba(255, 255, 255, 0.9);
}

.difficulty-card--renju .card-description {
  color: rgba(255, 255, 255, 0.9);
}

.difficulty-card--renju .progress-text {
  color: rgba(255, 255, 255, 0.9);
}

.difficulty-card--renju .progress-bar::-webkit-progress-bar {
  background: rgba(255, 255, 255, 0.25);
}

.difficulty-card--renju .progress-bar::-webkit-progress-value {
  background: rgba(255, 255, 255, 0.8);
}

.difficulty-card--renju .progress-bar::-moz-progress-bar {
  background: rgba(255, 255, 255, 0.8);
}

@media (max-width: 1000px) {
  .difficulty-grid {
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(3, 1fr);
  }
}

@media (max-width: 640px) {
  .difficulty-grid {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }
}
</style>
