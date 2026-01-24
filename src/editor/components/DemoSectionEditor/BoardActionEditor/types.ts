import type { BoardAction } from "@/types/scenario";

// 各アクションタイプの型エイリアス
export type PlaceAction = Extract<BoardAction, { type: "place" }>;
export type RemoveAction = Extract<BoardAction, { type: "remove" }>;
export type SetBoardAction = Extract<BoardAction, { type: "setBoard" }>;
export type MarkAction = Extract<BoardAction, { type: "mark" }>;
export type LineAction = Extract<BoardAction, { type: "line" }>;
export type ResetAllAction = Extract<BoardAction, { type: "resetAll" }>;
export type ResetMarkLineAction = Extract<
  BoardAction,
  { type: "resetMarkLine" }
>;

// 位置更新用の共通型
export type PositionKey = "position" | "fromPosition" | "toPosition";
export type PositionField = "row" | "col";
