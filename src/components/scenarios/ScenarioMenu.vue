<script setup lang="ts">
import type { Scenario } from "@/types/scenario";
import { computed } from "vue";

import scenariosIndex from "@/data/scenarios/index.json";
import { useProgressStore } from "@/stores/progressStore";

// Emits
const emit = defineEmits<{
  selectScenario: [scenarioId: string];
}>();

// Store
const progressStore = useProgressStore();

// Computed
const scenarios = computed(() => scenariosIndex.scenarios as Scenario[]);

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

const getDifficultyColor = (difficulty: string): string => {
  const colors = {
    advanced: "#F44336",
    beginner: "#4CAF50",
    intermediate: "#FF9800",
  };
  return colors[difficulty as keyof typeof colors] || "#999";
};

const getDifficultyLabel = (difficulty: string): string => {
  const labels = {
    advanced: "上級",
    beginner: "初級",
    intermediate: "中級",
  };
  return labels[difficulty as keyof typeof labels] || difficulty;
};
</script>

<template>
  <div class="scenario-menu">
    <div class="header">
      <h1>フブキ先生の連珠教室</h1>
      <p class="subtitle">学習シナリオを選んでください</p>

      <!-- 進捗サマリー -->
      <div class="progress-summary">
        <div class="progress-item">
          <span class="label">完了したシナリオ:</span>
          <span class="value">
            {{ progressStore.completedScenarios.length }} /
            {{ scenarios.length }}
          </span>
        </div>
        <div class="progress-item">
          <span class="label">総合スコア:</span>
          <span class="value">{{ progressStore.totalScore }}点</span>
        </div>
        <div class="progress-bar">
          <div
            class="progress-fill"
            :style="{ width: `${progressStore.completionRate}%` }"
          />
        </div>
      </div>
    </div>

    <!-- シナリオリスト -->
    <div class="scenario-list">
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
              backgroundColor: getDifficultyColor(scenario.difficulty),
            }"
          >
            {{ getDifficultyLabel(scenario.difficulty) }}
          </span>
        </div>

        <p class="description">
          {{ scenario.description }}
        </p>

        <div class="objectives">
          <h4>学習目標:</h4>
          <ul>
            <li
              v-for="(objective, index) in scenario.objectives"
              :key="index"
            >
              {{ objective }}
            </li>
          </ul>
        </div>

        <div class="card-footer">
          <span
            class="difficulty-badge"
            :style="{
              backgroundColor: getDifficultyColor(scenario.difficulty),
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
  padding: 40px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  overflow-y: auto;
  box-sizing: border-box;
}

.header {
  text-align: center;
  color: white;
  margin-bottom: 40px;
}

.header h1 {
  font-size: 48px;
  margin: 0 0 10px;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
}

.subtitle {
  font-size: 20px;
  margin: 0 0 30px;
  opacity: 0.9;
}

.progress-summary {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  backdrop-filter: blur(10px);
}

.progress-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 16px;
}

.progress-item .label {
  opacity: 0.9;
}

.progress-item .value {
  font-weight: bold;
}

.progress-bar {
  height: 8px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  overflow: hidden;
  margin-top: 15px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4caf50, #8bc34a);
  transition: width 0.3s ease;
}

.scenario-list {
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 30px;
}

.scenario-card {
  background: white;
  border-radius: 16px;
  padding: 24px;
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
  margin-bottom: 16px;
}

.card-header h3 {
  margin: 0;
  color: #333;
  font-size: 24px;
  flex: 1;
}

.difficulty-badge {
  padding: 6px 12px;
  border-radius: 6px;
  color: white;
  font-size: 12px;
  font-weight: bold;
}

.description {
  color: #666;
  line-height: 1.6;
  margin-bottom: 20px;
}

.objectives h4 {
  margin: 0 0 10px;
  color: #333;
  font-size: 16px;
}

.objectives ul {
  margin: 0;
  padding-left: 20px;
  color: #666;
}

.objectives li {
  margin-bottom: 6px;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #eee;
  gap: 12px;
}

.completed-badge {
  color: #4caf50;
  font-weight: bold;
  font-size: 14px;
}

.start-button {
  padding: 10px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: bold;
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
    font-size: 32px;
  }

  .subtitle {
    font-size: 16px;
  }

  .scenario-list {
    grid-template-columns: 1fr;
  }
}
</style>
