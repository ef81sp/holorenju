<script setup lang="ts">
import { computed } from "vue";

import PageHeader from "@/components/common/PageHeader.vue";
import { useAppStore } from "@/stores/appStore";
import { useProgressStore } from "@/stores/progressStore";
import type { ScenarioDifficulty } from "@/types/scenario";
import scenariosIndex from "@/data/scenarios/index.json";

const appStore = useAppStore();
const progressStore = useProgressStore();

interface ProgressInfo {
  completed: number;
  total: number;
  rate: number;
}

interface DifficultyCard {
  key: ScenarioDifficulty;
  label: string;
  icon: string;
  gradient: string;
  description: string;
}

const difficultyCards: DifficultyCard[] = [
  {
    key: "gomoku_beginner",
    label: "五目並べ:入門",
    icon: "🌱",
    gradient: "linear-gradient(135deg, #d2f6c5 0%, #f9f7d9 100%)",
    description: "五目並べの遊び方と連珠との違いからスタート",
  },
  {
    key: "gomoku_intermediate",
    label: "五目並べ:初級",
    icon: "⭐",
    gradient: "linear-gradient(135deg, #ffecd2 0%, #f6d365 100%)",
    description: "五目並べの基本戦術をひと通り固めるステップ",
  },
  {
    key: "renju_beginner",
    label: "連珠:入門",
    icon: "🎋",
    gradient: "linear-gradient(135deg, #cfd9df 0%, #e2ebf0 100%)",
    description: "禁手ルールや連珠ならではの基礎を確認",
  },
  {
    key: "renju_intermediate",
    label: "連珠:初級",
    icon: "🧭",
    gradient: "linear-gradient(135deg, #ffd3a5 0%, #fd6585 100%)",
    description: "基本形の活用や攻守の組み立てを学ぶ",
  },
  {
    key: "renju_advanced",
    label: "連珠:中級",
    icon: "🔥",
    gradient: "linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)",
    description: "実戦を意識した応用手筋と読みの強化",
  },
  {
    key: "renju_expert",
    label: "連珠:上級",
    icon: "👑",
    gradient: "linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)",
    description: "終盤力と緻密な布石運びで頂点を目指す",
  },
];

const getProgress = (difficulty: ScenarioDifficulty): ProgressInfo => {
  const difficultyData = scenariosIndex.difficulties[difficulty];
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
      <div class="difficulty-grid">
        <button
          v-for="(card, index) in difficultyCards"
          :key="card.key"
          class="difficulty-card"
          :style="{ background: card.gradient }"
          @click="handleSelectDifficulty(card.key)"
        >
          <div class="card-header">
            <span class="card-ordinal">{{ index + 1 }}</span>
            <span class="card-icon">{{ card.icon }}</span>
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
  font-size: var(--size-18);
  color: #1f2937;
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
  font-size: var(--size-14);
  font-weight: 700;
  flex-shrink: 0;
}

.card-icon {
  font-size: var(--size-28);
}

.card-label {
  line-height: 1.3;
  flex: 1;
}

.card-description {
  margin: 0;
  color: #374151;
  line-height: 1.5;
  font-size: var(--size-13);
}

.progress-info {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
}

.progress-text {
  font-size: var(--size-12);
  color: #111827;
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
