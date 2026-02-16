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
  const achievements = ref<string[]>([]);
  const lastPlayedAt = ref<Date>(new Date());
  const scenarioProgress = ref<Map<string, ScenarioProgress>>(new Map());

  // Getters
  const learningProgress = computed<LearningProgress>(() => ({
    achievements: achievements.value,
    completedScenarios: completedScenarios.value,
    currentScenario: currentScenario.value,
    lastPlayedAt: lastPlayedAt.value,
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
        completedSections: [],
        currentSectionIndex: 0,
        isCompleted: false,
        scenarioId,
      });
    }
  }

  function completeSection(scenarioId: string, sectionId: string): void {
    const progress = scenarioProgress.value.get(scenarioId);
    if (!progress) {
      return;
    }

    if (!progress.completedSections.includes(sectionId)) {
      progress.completedSections.push(sectionId);
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
    achievements.value = [];
    lastPlayedAt.value = new Date();
    scenarioProgress.value.clear();

    localStorage.removeItem(STORAGE_KEY);
  }

  function getScenarioProgress(scenarioId: string): ScenarioProgress | null {
    return scenarioProgress.value.get(scenarioId) || null;
  }

  /**
   * シナリオ構造変更時に進行度を整合させる
   *
   * ハッシュが一致すれば何もしない。不一致なら孤立セクションの進行度を除去し、
   * currentSectionIndex をクランプ、isCompleted を再計算する。
   */
  function reconcileProgress(
    scenarioId: string,
    structureHash: string,
    sectionIds: string[],
    questionSectionIds: string[],
  ): void {
    const progress = scenarioProgress.value.get(scenarioId);
    if (!progress) {
      return;
    }

    if (progress.structureHash === structureHash) {
      return;
    }

    // 存続セクションのみ保持
    const currentIds = new Set(sectionIds);
    progress.completedSections = progress.completedSections.filter((id) =>
      currentIds.has(id),
    );

    // currentSectionIndex をセクション数内にクランプ
    const maxIndex = Math.max(0, sectionIds.length - 1);
    progress.currentSectionIndex = Math.min(
      progress.currentSectionIndex,
      maxIndex,
    );

    // isCompleted 再計算: 全questionセクションが完了しているか
    const allQuestionsCompleted = questionSectionIds.every((id) =>
      progress.completedSections.includes(id),
    );
    if (!allQuestionsCompleted && progress.isCompleted) {
      progress.isCompleted = false;
      completedScenarios.value = completedScenarios.value.filter(
        (id) => id !== scenarioId,
      );
    }

    progress.structureHash = structureHash;
    saveProgress();
  }

  // 初期化時に進度を読み込む
  loadProgress();

  return {
    // State
    completedScenarios,
    currentScenario,
    achievements,
    lastPlayedAt,
    // Getters
    learningProgress,
    completionRate,
    // Actions
    startScenario,
    completeSection,
    completeScenario,
    addAchievement,
    saveProgress,
    loadProgress,
    resetProgress,
    getScenarioProgress,
    reconcileProgress,
  };
});
