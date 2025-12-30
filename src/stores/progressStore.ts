/**
 * 学習進度管理ストア
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { LearningProgress, ScenarioProgress } from "@/types/scenario";

const STORAGE_KEY = "holorenju_progress";

export const useProgressStore = defineStore("progress", () => {
  // State
  const completedScenarios = ref<string[]>([]);
  const currentScenario = ref<string | null>(null);
  const totalScore = ref(0);
  const achievements = ref<string[]>([]);
  const lastPlayedAt = ref<Date>(new Date());
  const scenarioProgress = ref<Map<string, ScenarioProgress>>(new Map());

  // Getters
  const learningProgress = computed<LearningProgress>(() => ({
    achievements: achievements.value,
    completedScenarios: completedScenarios.value,
    currentScenario: currentScenario.value,
    lastPlayedAt: lastPlayedAt.value,
    totalScore: totalScore.value,
  }));

  const completionRate = computed(() => {
    const totalScenarios = 3; // MVP: 3つのシナリオ
    return (completedScenarios.value.length / totalScenarios) * 100;
  });

  // Actions
  function startScenario(scenarioId: string): void {
    currentScenario.value = scenarioId;

    if (!scenarioProgress.value.has(scenarioId)) {
      scenarioProgress.value.set(scenarioId, {
        completedSteps: [],
        currentStepIndex: 0,
        isCompleted: false,
        scenarioId,
        score: 0,
      });
    }
  }

  function completeStep(
    scenarioId: string,
    stepId: string,
    score: number,
  ): void {
    const progress = scenarioProgress.value.get(scenarioId);
    if (!progress) {
      return;
    }

    if (!progress.completedSteps.includes(stepId)) {
      progress.completedSteps.push(stepId);
      progress.score += score;
      totalScore.value += score;
    }

    saveProgress();
  }

  function completeScenario(scenarioId: string): void {
    const progress = scenarioProgress.value.get(scenarioId);
    if (!progress) {
      return;
    }

    progress.isCompleted = true;

    if (!completedScenarios.value.includes(scenarioId)) {
      completedScenarios.value.push(scenarioId);
    }

    currentScenario.value = null;
    lastPlayedAt.value = new Date();

    saveProgress();
  }

  function addAchievement(achievementId: string): void {
    if (!achievements.value.includes(achievementId)) {
      achievements.value.push(achievementId);
      saveProgress();
    }
  }

  function saveProgress(): void {
    const data = {
      achievements: achievements.value,
      completedScenarios: completedScenarios.value,
      currentScenario: currentScenario.value,
      lastPlayedAt: lastPlayedAt.value.toISOString(),
      scenarioProgress: Array.from(scenarioProgress.value.entries()),
      totalScore: totalScore.value,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function loadProgress(): void {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return;
    }

    try {
      const data = JSON.parse(saved);
      completedScenarios.value = data.completedScenarios || [];
      currentScenario.value = data.currentScenario || null;
      totalScore.value = data.totalScore || 0;
      achievements.value = data.achievements || [];
      lastPlayedAt.value = new Date(data.lastPlayedAt || new Date());

      if (data.scenarioProgress) {
        scenarioProgress.value = new Map(data.scenarioProgress);
      }
    } catch (error) {
      console.error("Failed to load progress:", error);
    }
  }

  function resetProgress(): void {
    completedScenarios.value = [];
    currentScenario.value = null;
    totalScore.value = 0;
    achievements.value = [];
    lastPlayedAt.value = new Date();
    scenarioProgress.value.clear();

    localStorage.removeItem(STORAGE_KEY);
  }

  function getScenarioProgress(scenarioId: string): ScenarioProgress | null {
    return scenarioProgress.value.get(scenarioId) || null;
  }

  // 初期化時に進度を読み込む
  loadProgress();

  return {
    // State
    completedScenarios,
    currentScenario,
    totalScore,
    achievements,
    lastPlayedAt,
    // Getters
    learningProgress,
    completionRate,
    // Actions
    startScenario,
    completeStep,
    completeScenario,
    addAchievement,
    saveProgress,
    loadProgress,
    resetProgress,
    getScenarioProgress,
  };
});
