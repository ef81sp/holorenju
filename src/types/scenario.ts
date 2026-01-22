/**
 * シナリオ関連の型定義
 */

import type { CharacterType, EmotionId } from "./character";
import type { Position } from "./game";
import type { TextNode } from "./text";

// シナリオの難易度一覧（UIやバリデーションで共通利用）
const DIFFICULTIES = [
  "gomoku_beginner",
  "gomoku_intermediate",
  "renju_beginner",
  "renju_intermediate",
  "renju_advanced",
  "renju_expert",
] as const;

type ScenarioDifficulty = (typeof DIFFICULTIES)[number];

// 難易度ラベル（日本語表示用）
const DIFFICULTY_LABELS: Record<ScenarioDifficulty, string> = {
  gomoku_beginner: "五目並べ:入門",
  gomoku_intermediate: "五目並べ:初級",
  renju_beginner: "連珠:入門",
  renju_intermediate: "連珠:初級",
  renju_advanced: "連珠:中級",
  renju_expert: "連珠:上級",
};

// シナリオメタデータ（index.jsonエントリ用）
interface ScenarioMeta {
  id: string;
  title: string;
  description: string;
  path: string;
}

// 難易度ごとのデータ
interface DifficultyData {
  label: string;
  scenarios: ScenarioMeta[];
}

// シナリオインデックス全体
interface ScenarioIndex {
  difficulties: Partial<Record<ScenarioDifficulty, DifficultyData>>;
}

// ===== ベースセクション =====

interface BaseSection {
  id: string;
  type: "demo" | "question";
  title: string;
}

type Section = DemoSection | QuestionSection;

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
    clear?: boolean; // trueの場合、説明をクリア（textが空の時のみ有効）
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
  action?: "draw" | "remove";
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

interface QuestionSection extends BaseSection {
  type: "question";
  initialBoard: string[];
  description: TextNode[];
  dialogues: DemoDialogue[];
  successOperator?: SuccessOperator;
  successConditions: SuccessCondition[];
  feedback: QuestionFeedback;
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

interface QuestionFeedback {
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
  Section,
  DemoSection,
  DemoDialogue,
  BoardAction,
  PlaceMoveAction,
  RemoveMoveAction,
  SetBoardAction,
  MarkAction,
  LineAction,
  QuestionSection,
  SuccessCondition,
  PositionCondition,
  PatternCondition,
  SequenceCondition,
  QuestionFeedback,
  DialogueLine,
  Scenario,
  ScenarioProgress,
  LearningProgress,
  BaseSection,
  Position,
  SuccessOperator,
  ScenarioDifficulty,
  ScenarioMeta,
  DifficultyData,
  ScenarioIndex,
};

export { DIFFICULTIES, DIFFICULTY_LABELS };
