<script setup lang="ts">
import { computed, onMounted } from "vue";

import { useProgressStore } from "@/stores/progressStore";
import { useScenarioIndexStore } from "@/stores/scenarioIndexStore";
import {
  DIFFICULTY_LABELS,
  type ScenarioDifficulty,
  type ScenarioMeta,
} from "@/types/scenario";
import ProgressSummary from "./ProgressSummary.vue";

interface ScenarioWithDifficulty extends ScenarioMeta {
  difficulty: ScenarioDifficulty;
}

// Emits
const emit = defineEmits<{
  selectScenario: [scenarioId: string];
}>();

// Store
const progressStore = useProgressStore();
const indexStore = useScenarioIndexStore();

onMounted(async () => {
  await indexStore.loadIndex();
});

// Computed
const scenarios = computed(() => {
  const allScenarios: ScenarioWithDifficulty[] = [];
  if (indexStore.index?.difficulties) {
    Object.entries(indexStore.index.difficulties).forEach(
      ([difficulty, diff]) => {
        diff.scenarios.forEach((scenario) => {
          allScenarios.push({
            ...scenario,
            difficulty: difficulty as ScenarioDifficulty,
          });
        });
      },
    );
  }
  return allScenarios;
});

const scenarioProgress = computed(() =>
  scenarios.value.map((scenario) => ({
    ...scenario,
    isCompleted: progressStore.completedScenarios.includes(scenario.id),
    progress: progressStore.getScenarioProgress(scenario.id),
  })),
);

// Methods
const handleSelectScenario = (scenarioId: string): void => {
  emit("selectScenario", scenarioId);
};

const DIFFICULTY_COLORS: Record<ScenarioDifficulty, string> = {
  gomoku_beginner:
    "linear-gradient(135deg, var(--color-fubuki-primary), var(--color-fubuki-bg))",
  gomoku_intermediate:
    "linear-gradient(135deg, #f9c449, var(--color-holo-cyan))",
  renju_beginner: "linear-gradient(135deg, #b7becd, #e6edf5)",
  renju_intermediate: "linear-gradient(135deg, #ff9f7f, #ffd3a5)",
  renju_advanced: "linear-gradient(135deg, #6fd3a7, #3fbfb9)",
  renju_expert:
    "linear-gradient(135deg, var(--color-miko-300), var(--color-miko-500))",
};

const getDifficultyColor = (difficulty: ScenarioDifficulty): string =>
  DIFFICULTY_COLORS[difficulty] ?? "var(--color-text-secondary)";

const getDifficultyLabel = (difficulty: ScenarioDifficulty): string =>
  DIFFICULTY_LABELS[difficulty] ?? difficulty;
</script>

<template>
  <div class="scenario-menu">
    <div class="header">
      <div>
        <h1>ホロ連珠</h1>
        <small>フブみこさんと学ぶ連珠教室</small>
      </div>
      <ProgressSummary :total-scenarios="scenarios.length" />
    </div>

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

    <!-- シナリオリスト -->
    <div
      v-else
      class="scenario-list"
    >
      <div
        v-for="scenario in scenarioProgress"
        :key="scenario.id"
        class="scenario-card"
        :class="{ completed: scenario.isCompleted }"
        @click="handleSelectScenario(scenario.id)"
      >
        <div class="card-header">
          <h3>{{ scenario.title }}</h3>
          <span
            class="difficulty-badge"
            :style="{
              backgroundImage: getDifficultyColor(scenario.difficulty),
            }"
          >
            {{ getDifficultyLabel(scenario.difficulty) }}
          </span>
        </div>

        <p class="description">
          {{ scenario.description }}
        </p>

        <div class="card-footer">
          <span
            class="difficulty-badge"
            :style="{
              backgroundImage: getDifficultyColor(scenario.difficulty),
            }"
          >
            {{ getDifficultyLabel(scenario.difficulty) }}
          </span>
          <span
            v-if="scenario.isCompleted"
            class="completed-badge"
          >
            ✓ 完了済み
          </span>
          <button class="start-button">
            {{ scenario.isCompleted ? "復習する" : "学習開始" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scenario-menu {
  height: 100%;
  padding: var(--size-40) var(--size-20);
  overflow-y: auto;
  box-sizing: border-box;
}

.loading,
.error {
  font-size: var(--font-size-20);
  color: var(--color-text-secondary);
  text-align: center;
  padding: var(--size-40);
}

.error {
  color: #dc2626;
}

.header {
  display: grid;
  grid-template-columns: 3fr 1fr;
  gap: var(--size-20);
  align-items: start;
  margin-bottom: var(--size-40);
  color: var(--color-text-primary);
  font-size: var(--font-size-32);
  line-height: var(--size-32);
  & small {
    font-size: var(--font-size-16);
    opacity: 0.8;
  }
}

.header h1 {
  font-size: var(--font-size-48);
  margin: 0;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
}

.subtitle {
  font-size: var(--font-size-20);
  margin: 0 0 var(--size-30);
  opacity: 0.9;
}

.scenario-list {
  max-width: var(--size-1200);
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--size-350), 1fr));
  gap: var(--size-30);
}

.scenario-card {
  background: white;
  border-radius: 16px;
  padding: var(--size-24);
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.scenario-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
}

.scenario-card.completed {
  border: 3px solid #4caf50;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--size-16);
}

.card-header h3 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-24);
  flex: 1;
}

.difficulty-badge {
  padding: var(--size-6) var(--size-12);
  border-radius: 6px;
  color: white;
  font-size: var(--font-size-12);
  font-weight: 500;
}

.description {
  color: var(--color-text-secondary);
  font-size: var(--font-size-14);
  line-height: 1.6;
  margin-bottom: var(--size-20);
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--size-20);
  padding-top: var(--size-20);
  border-top: 1px solid #eee;
  gap: var(--size-12);
}

.completed-badge {
  color: var(--color-fubuki-primary);
  font-weight: 500;
  font-size: var(--font-size-14);
}

.start-button {
  padding: var(--size-10) var(--size-20);
  background: linear-gradient(135deg, #5fdeec 0%, #46c0ef 100%);
  color: var(--color-text-primary);
  border: none;
  border-radius: 8px;
  font-size: var(--font-size-14);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  margin-left: auto;
}

.start-button:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

@media (max-width: 768px) {
  .header h1 {
    font-size: var(--font-size-32);
  }

  .subtitle {
    font-size: var(--font-size-16);
  }

  .scenario-list {
    grid-template-columns: 1fr;
  }
}
</style>
