/**
 * ゲーム関連の型定義
 */

// 石の色
type StoneColor = "black" | "white" | null;

// 盤面の座標
interface Position {
  row: number;
  col: number;
}

// 盤面の状態（15x15）
type BoardState = StoneColor[][];

// ゲームモード
type GameMode = "scenario" | "free-play";

// ゲームの状態
interface GameState {
  board: BoardState;
  currentTurn: StoneColor;
  moveHistory: Position[];
  isGameOver: boolean;
  winner: StoneColor;
}

// 仮指定中の石
interface PreviewStone {
  position: Position;
  color: StoneColor;
}

// 禁じ手の種類
type ForbiddenMoveType = "double-three" | "double-four" | "overline" | null;

// 禁じ手の判定結果
interface ForbiddenMoveResult {
  isForbidden: boolean;
  type: ForbiddenMoveType;
  positions?: Position[];
}

// パターンの種類
type PatternType =
  | "open-three"
  | "open-four"
  | "four-three"
  | "five"
  | "overline";

// パターン認識結果
interface PatternRecognition {
  type: PatternType;
  positions: Position[];
  direction: "horizontal" | "vertical" | "diagonal-right" | "diagonal-left";
}

export type {
  StoneColor,
  Position,
  BoardState,
  GameMode,
  GameState,
  PreviewStone,
  ForbiddenMoveType,
  ForbiddenMoveResult,
  PatternType,
  PatternRecognition,
};
