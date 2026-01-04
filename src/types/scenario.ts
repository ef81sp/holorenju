/**
 * シナリオ関連の型定義
 */

import type { CharacterType, EmotionId } from "./character";
import type { Position } from "./game";
import type { TextNode } from "./text";

// シナリオの難易度
type ScenarioDifficulty = "beginner" | "intermediate" | "advanced";

// ===== ベースセクション =====

interface BaseSection {
  id: string;
  type: "demo" | "problem";
  title: string;
}

type Section = DemoSection | ProblemSection;

// 成功条件の評価方法
type SuccessOperator = "or" | "and";

// ===== デモセクション =====

interface DemoSection extends BaseSection {
  type: "demo";
  initialBoard: string[];
  dialogues: DemoDialogue[];
}

interface DemoDialogue {
  id: string;
  character: CharacterType;
  text: TextNode[];
  emotion: EmotionId; // 0-39の連番ID
  description?: {
    text: TextNode[];
    type: "new" | "continue";
  };
  boardActions: BoardAction[];
}

// ===== 盤面操作 =====

type BoardAction =
  | PlaceMoveAction
  | RemoveMoveAction
  | SetBoardAction
  | MarkAction
  | LineAction
  | ResetAllAction;

interface PlaceMoveAction {
  type: "place";
  position: Position;
  color: "black" | "white";
  highlight?: boolean;
}

interface RemoveMoveAction {
  type: "remove";
  position: Position;
}

interface SetBoardAction {
  type: "setBoard";
  board: string[];
}

interface MarkAction {
  type: "mark";
  positions: Position[];
  markType: "circle" | "cross" | "arrow";
  label?: string;
}

interface LineAction {
  type: "line";
  fromPosition: Position;
  toPosition: Position;
  action: "draw" | "remove";
  style?: "solid" | "dashed";
}

interface ResetAllAction {
  type: "resetAll";
}

// ===== 問題セクション =====

interface ProblemSection extends BaseSection {
  type: "problem";
  initialBoard: string[];
  description: TextNode[];
  dialogues: DemoDialogue[];
  successOperator?: SuccessOperator;
  successConditions: SuccessCondition[];
  feedback: ProblemFeedback;
}

type SuccessCondition =
  | PositionCondition
  | PatternCondition
  | SequenceCondition;

interface PositionCondition {
  type: "position";
  positions: Position[];
  color: "black" | "white";
}

interface PatternCondition {
  type: "pattern";
  pattern: string;
  color: "black" | "white";
}

interface SequenceCondition {
  type: "sequence";
  moves: (Position & { color: "black" | "white" })[];
  strict: boolean;
}

interface ProblemFeedback {
  success: DialogueLine[];
  failure: DialogueLine[];
  progress?: DialogueLine[];
}

interface DialogueLine {
  character: CharacterType;
  text: TextNode[];
  emotion: EmotionId; // 0-39の連番ID
}

// ===== シナリオ全体 =====

interface Scenario {
  id: string;
  title: string;
  difficulty: ScenarioDifficulty;
  description: string;
  objectives: string[];
  sections: Section[];
}

// ===== 進行状況 =====

interface ScenarioProgress {
  scenarioId: string;
  currentSectionIndex: number;
  completedSections: string[];
  currentDialogueIndex?: number;
  attempts?: Record<string, number>;
  hintsUsed?: Record<string, number>;
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
  Section,
  DemoSection,
  DemoDialogue,
  BoardAction,
  PlaceMoveAction,
  RemoveMoveAction,
  SetBoardAction,
  MarkAction,
  LineAction,
  ProblemSection,
  SuccessCondition,
  PositionCondition,
  PatternCondition,
  SequenceCondition,
  ProblemFeedback,
  DialogueLine,
  Scenario,
  ScenarioProgress,
  LearningProgress,
  BaseSection,
  Position,
  SuccessOperator,
};
