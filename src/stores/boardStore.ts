/**
 * 盤面状態管理ストア
 *
 * stonesをSSoT（Single Source of Truth）とし、boardはstonesから導出。
 * シナリオプレイヤーなどで盤面を指定された色で操作するのに使用。
 *
 * アニメーション管理はscenarioAnimationStoreに分離済み。
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";

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
  // ========== State ==========
  // stonesがSSoT（Single Source of Truth）
  const stones = ref<Stone[]>([]);
  const marks = ref<Mark[]>([]);
  const lines = ref<Line[]>([]);
  const lastPlacedStone = ref<{
    position: Position;
    color: StoneColor;
  } | null>(null);

  // ========== Computed ==========
  // boardはstonesから導出
  const board = computed<BoardState>(() => {
    const grid = createEmptyBoard();
    for (const stone of stones.value) {
      const row = grid[stone.position.row];
      if (row) {
        row[stone.position.col] = stone.color;
      }
    }
    return grid;
  });

  // ========== Callbacks ==========
  type OnStonePlacedCallback = (
    position: Position,
    color: StoneColor,
  ) => Promise<void>;
  let onStonePlacedCallback: OnStonePlacedCallback | null = null;

  // ========== Actions ==========

  /**
   * 盤面を一括設定（stonesに変換）
   * @param newBoard 新しい盤面状態
   * @param dialogueIndex 配置時のダイアログインデックス（デフォルト: -1）
   */
  function setBoard(newBoard: BoardState, dialogueIndex = -1): void {
    const newStones: Stone[] = [];
    for (let row = 0; row < newBoard.length; row++) {
      const rowData = newBoard[row];
      if (!rowData) {
        continue;
      }
      for (let col = 0; col < rowData.length; col++) {
        const color = rowData[col];
        if (color) {
          newStones.push({
            id: `${dialogueIndex}-${row}-${col}`,
            position: { row, col },
            color,
            placedAtDialogueIndex: dialogueIndex,
          });
        }
      }
    }
    stones.value = newStones;
    lastPlacedStone.value = null;
  }

  /**
   * 石を配置（ゲームモード用）
   */
  function placeStone(
    position: Position,
    color: StoneColor,
    options?: { animate?: boolean; dialogueIndex?: number },
  ): {
    success: boolean;
    message?: string;
  } {
    // すでに石が置かれている
    if (board.value[position.row]?.[position.col] !== null) {
      return { message: "すでに石が置かれています", success: false };
    }

    const index = options?.dialogueIndex ?? -1;
    const id = `${index}-${position.row}-${position.col}`;

    stones.value.push({
      id,
      position,
      color,
      placedAtDialogueIndex: index,
    });

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

  /**
   * 石を削除
   */
  function removeStone(position: Position): {
    success: boolean;
    message?: string;
  } {
    stones.value = stones.value.filter(
      (s) => s.position.row !== position.row || s.position.col !== position.col,
    );
    return { success: true };
  }

  /**
   * 盤面をリセット
   */
  function resetBoard(): void {
    stones.value = [];
    lastPlacedStone.value = null;
  }

  /**
   * コールバック設定関数
   */
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
   * 石・マーク・ライン全てをリセット
   */
  function resetAll(): void {
    stones.value = [];
    marks.value = [];
    lines.value = [];
    lastPlacedStone.value = null;
  }

  return {
    // State
    board, // computed
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
