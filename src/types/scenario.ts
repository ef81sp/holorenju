/**
 * シナリオ関連の型定義
 */

import type { Position } from "./game";

// シナリオの難易度
type ScenarioDifficulty = "beginner" | "intermediate" | "advanced";

// シナリオのステップ
interface ScenarioStep {
  id: string;
  title: string;
  description: string;
  initialBoard: string[];
  expectedMoves?: Position[];
  hint?: string;
  dialogs?: Record<string, unknown>;
}

// シナリオ
interface Scenario {
  id: string;
  title: string;
  difficulty: ScenarioDifficulty;
  description: string;
  objectives: string[];
  steps: ScenarioStep[];
  dialogs?: Record<string, unknown>;
}

// シナリオの進行状態
interface ScenarioProgress {
  scenarioId: string;
  currentStepIndex: number;
  completedSteps: string[];
  isCompleted: boolean;
  score: number;
}

// 学習進度
interface LearningProgress {
  completedScenarios: string[];
  currentScenario: string | null;
  totalScore: number;
  achievements: string[];
  lastPlayedAt: Date;
}

export type {
  ScenarioDifficulty,
  ScenarioStep,
  Scenario,
  ScenarioProgress,
  LearningProgress,
};
