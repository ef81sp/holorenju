import type { BoardAction } from "@/types/scenario";

// 各アクションタイプの型エイリアス
export type PlaceAction = Extract<BoardAction, { type: "place" }>;
export type RemoveAction = Extract<BoardAction, { type: "remove" }>;
export type SetBoardAction = Extract<BoardAction, { type: "setBoard" }>;
export type MarkAction = Extract<BoardAction, { type: "mark" }>;
export type LineAction = Extract<BoardAction, { type: "line" }>;
export type ResetAllAction = Extract<BoardAction, { type: "resetAll" }>;

// 位置更新用の共通型
export type PositionKey = "position" | "fromPosition" | "toPosition";
export type PositionField = "row" | "col";

// 位置入力のバリデーション（0-14の範囲に制限）
export const clampPosition = (value: string): number =>
  Math.max(0, Math.min(14, parseInt(value, 10) || 0));
