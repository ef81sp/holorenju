/**
 * 盤面状態管理ストア
 *
 * 盤面情報のみを管理し、ターン情報は持たない。
 * シナリオプレイヤーなどで盤面を指定された色で操作するのに使用。
 *
 * アニメーション管理はscenarioAnimationStoreに分離済み。
 */

import { defineStore } from "pinia";
import { ref } from "vue";

import type { BoardState, Position, StoneColor } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

/**
 * シナリオ用の石オブジェクト
 * どのダイアログで配置されたかを追跡
 */
export interface Stone {
  id: string;
  position: Position;
  color: StoneColor;
  placedAtDialogueIndex: number;
}

/**
 * シナリオ用のマークオブジェクト
 */
export interface Mark {
  id: string;
  positions: Position[];
  markType: "circle" | "cross" | "arrow";
  label?: string;
  placedAtDialogueIndex: number;
}

/**
 * シナリオ用のラインオブジェクト
 */
export interface Line {
  id: string;
  fromPosition: Position;
  toPosition: Position;
  style: "solid" | "dashed";
  placedAtDialogueIndex: number;
}

export const useBoardStore = defineStore("board", () => {
  // State
  const board = ref<BoardState>(createEmptyBoard());
  const lastPlacedStone = ref<{
    position: Position;
    color: StoneColor;
  } | null>(null);

  // シナリオ用の石配列（ダイアログインデックス追跡付き）
  const stones = ref<Stone[]>([]);

  // シナリオ用のマーク・ライン配列
  const marks = ref<Mark[]>([]);
  const lines = ref<Line[]>([]);

  // Callbacks (placeStone用のみ残す)
  type OnStonePlacedCallback = (
    position: Position,
    color: StoneColor,
  ) => Promise<void>;
  let onStonePlacedCallback: OnStonePlacedCallback | null = null;

  // Actions
  function placeStone(
    position: Position,
    color: StoneColor,
    options?: { animate?: boolean },
  ): {
    success: boolean;
    message?: string;
  } {
    // すでに石が置かれている
    if (board.value[position.row]?.[position.col] !== null) {
      return { message: "すでに石が置かれています", success: false };
    }

    // 石を配置
    const row = board.value[position.row];
    if (row) {
      row[position.col] = color;
    }

    // 最後に配置された石の情報を記録
    lastPlacedStone.value = { position, color };

    // コールバック実行（非同期対応）
    // animate: falseの場合はコールバックをスキップ
    if (options?.animate !== false && onStonePlacedCallback) {
      onStonePlacedCallback(position, color).catch(() => {
        // アニメーション完了エラーは無視
      });
    }

    return { success: true };
  }

  function removeStone(position: Position): {
    success: boolean;
    message?: string;
  } {
    const row = board.value[position.row];
    if (row) {
      row[position.col] = null;
    }

    return { success: true };
  }

  function setBoard(newBoard: BoardState): void {
    board.value = newBoard.map((row: StoneColor[]) => [...row]);
    // SetBoard時はアニメーション対象外にするため、lastPlacedStoneをクリア
    lastPlacedStone.value = null;
  }

  function resetBoard(): void {
    board.value = createEmptyBoard();
    lastPlacedStone.value = null;
  }

  // コールバック設定関数
  function setOnStonePlacedCallback(
    callback: OnStonePlacedCallback | null,
  ): void {
    onStonePlacedCallback = callback;
  }

  // --- シナリオ用の石管理 ---

  /**
   * 石を追加（シナリオ用）
   * 同期的にデータ追加のみ行い、追加された石の配列を返す
   * アニメーションはscenarioAnimationStoreで行う
   */
  function addStones(
    newStones: { position: Position; color: StoneColor }[],
    dialogueIndex: number,
  ): Stone[] {
    const addedStones: Stone[] = [];

    for (const stone of newStones) {
      const id = `${dialogueIndex}-${stone.position.row}-${stone.position.col}`;
      const newStone: Stone = {
        id,
        position: stone.position,
        color: stone.color,
        placedAtDialogueIndex: dialogueIndex,
      };
      stones.value.push(newStone);
      addedStones.push(newStone);
    }

    return addedStones;
  }

  /**
   * 指定ダイアログインデックスの石を削除
   */
  function removeStonesByDialogueIndex(dialogueIndex: number): void {
    stones.value = stones.value.filter(
      (s) => s.placedAtDialogueIndex !== dialogueIndex,
    );
  }

  /**
   * 全ての石をクリア（セクション切り替え時など）
   */
  function clearStones(): void {
    stones.value = [];
  }

  // --- マーク管理 ---

  /**
   * マークを追加（シナリオ用）
   * 同期的にデータ追加のみ行い、追加されたマークの配列を返す
   */
  function addMarks(
    newMarks: {
      positions: Position[];
      markType: "circle" | "cross" | "arrow";
      label?: string;
    }[],
    dialogueIndex: number,
  ): Mark[] {
    const addedMarks: Mark[] = [];

    for (let i = 0; i < newMarks.length; i++) {
      const markData = newMarks[i];
      if (!markData) {
        continue;
      }
      const id = `${dialogueIndex}-mark-${i}`;
      const newMark: Mark = {
        id,
        positions: markData.positions,
        markType: markData.markType,
        label: markData.label,
        placedAtDialogueIndex: dialogueIndex,
      };
      marks.value.push(newMark);
      addedMarks.push(newMark);
    }

    return addedMarks;
  }

  /**
   * マークをクリア
   */
  function clearMarks(): void {
    marks.value = [];
  }

  // --- ライン管理 ---

  /**
   * ラインを追加（シナリオ用）
   * 同期的にデータ追加のみ行い、追加されたラインの配列を返す
   */
  function addLines(
    newLines: {
      fromPosition: Position;
      toPosition: Position;
      style?: "solid" | "dashed";
    }[],
    dialogueIndex: number,
  ): Line[] {
    const addedLines: Line[] = [];

    for (let i = 0; i < newLines.length; i++) {
      const lineData = newLines[i];
      if (!lineData) {
        continue;
      }
      const id = `${dialogueIndex}-line-${i}`;
      const newLine: Line = {
        id,
        fromPosition: lineData.fromPosition,
        toPosition: lineData.toPosition,
        style: lineData.style ?? "solid",
        placedAtDialogueIndex: dialogueIndex,
      };
      lines.value.push(newLine);
      addedLines.push(newLine);
    }

    return addedLines;
  }

  /**
   * ラインをクリア
   */
  function clearLines(): void {
    lines.value = [];
  }

  /**
   * 石・マーク・ライン・盤面全てをリセット
   */
  function resetAll(): void {
    stones.value = [];
    marks.value = [];
    lines.value = [];
    resetBoard();
  }

  return {
    // State
    board,
    lastPlacedStone,
    stones,
    marks,
    lines,
    // Actions
    placeStone,
    removeStone,
    setBoard,
    resetBoard,
    setOnStonePlacedCallback,
    // シナリオ用
    addStones,
    removeStonesByDialogueIndex,
    clearStones,
    // マーク・ライン
    addMarks,
    clearMarks,
    addLines,
    clearLines,
    resetAll,
  };
});
