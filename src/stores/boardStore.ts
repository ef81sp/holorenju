/**
 * 盤面状態管理ストア
 *
 * 盤面情報のみを管理し、ターン情報は持たない。
 * シナリオプレイヤーなどで盤面を指定された色で操作するのに使用。
 */

import { defineStore } from "pinia";
import { ref } from "vue";

import type { BoardState, Position, StoneColor } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

/**
 * シナリオ用の石オブジェクト
 * どのダイアログで配置されたかを追跡し、アニメーション制御に使用
 */
export interface Stone {
  id: string;
  position: Position;
  color: StoneColor;
  placedAtDialogueIndex: number;
  shouldAnimate: boolean;
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
  shouldAnimate: boolean;
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
  shouldAnimate: boolean;
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

  // Callbacks
  type OnStonePlacedCallback = (
    position: Position,
    color: StoneColor,
  ) => Promise<void>;
  let onStonePlacedCallback: OnStonePlacedCallback | null = null;

  type OnStoneAddedCallback = (position: Position) => Promise<void>;
  let onStoneAddedCallback: OnStoneAddedCallback | null = null;

  type OnAnimationCancelCallback = () => void;
  let onAnimationCancelCallback: OnAnimationCancelCallback | null = null;

  type OnMarkAddedCallback = (mark: Mark) => Promise<void>;
  let onMarkAddedCallback: OnMarkAddedCallback | null = null;

  type OnLineAddedCallback = (line: Line) => Promise<void>;
  let onLineAddedCallback: OnLineAddedCallback | null = null;

  // 呼び出しID管理（レースコンディション対策）
  let currentAddStonesId: number | null = null;
  let addStonesIdCounter = 0;
  let currentAddMarksId: number | null = null;
  let addMarksIdCounter = 0;
  let currentAddLinesId: number | null = null;
  let addLinesIdCounter = 0;

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
   * アニメーションありの場合、shouldAnimate: trueで追加し、完了後にfalseに変更
   * キャンセル時はアニメーションをスキップして即時配置
   */
  async function addStones(
    newStones: { position: Position; color: StoneColor }[],
    dialogueIndex: number,
    options?: { animate?: boolean },
  ): Promise<void> {
    // ユニークなIDを発行（レースコンディション対策）
    const callId = ++addStonesIdCounter;
    currentAddStonesId = callId;

    let shouldAnimate = options?.animate !== false;

    // 石を順次追加・アニメーション（順序保証のためループ内await）
    for (const stone of newStones) {
      // 自分の呼び出しがキャンセルされたか確認
      if (currentAddStonesId !== callId) {
        shouldAnimate = false;
      }

      const id = `${dialogueIndex}-${stone.position.row}-${stone.position.col}`;
      const newStone: Stone = {
        id,
        position: stone.position,
        color: stone.color,
        placedAtDialogueIndex: dialogueIndex,
        shouldAnimate,
      };
      stones.value.push(newStone);

      if (shouldAnimate && onStoneAddedCallback) {
        // oxlint-disable-next-line no-await-in-loop -- 順次アニメーション実行のため意図的
        await onStoneAddedCallback(stone.position);

        // await後も再チェック（アニメーション中にキャンセルされた可能性）
        if (currentAddStonesId !== callId) {
          shouldAnimate = false;
        }
        newStone.shouldAnimate = false;
      }
    }
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
   * 進行中のアニメーションもキャンセルする
   */
  function clearStones(): void {
    cancelOngoingAnimations();
    stones.value = [];
  }

  // --- マーク管理 ---

  /**
   * マークを追加（シナリオ用）
   */
  async function addMarks(
    newMarks: {
      positions: Position[];
      markType: "circle" | "cross" | "arrow";
      label?: string;
    }[],
    dialogueIndex: number,
    options?: { animate?: boolean },
  ): Promise<void> {
    const callId = ++addMarksIdCounter;
    currentAddMarksId = callId;
    let shouldAnimate = options?.animate !== false;

    for (let i = 0; i < newMarks.length; i++) {
      if (currentAddMarksId !== callId) {
        shouldAnimate = false;
      }

      const markData = newMarks[i];
      const id = `${dialogueIndex}-mark-${i}`;
      const newMark: Mark = {
        id,
        positions: markData.positions,
        markType: markData.markType,
        label: markData.label,
        placedAtDialogueIndex: dialogueIndex,
        shouldAnimate,
      };
      marks.value.push(newMark);

      if (shouldAnimate && onMarkAddedCallback) {
        // oxlint-disable-next-line no-await-in-loop -- 順次アニメーション実行のため意図的
        await onMarkAddedCallback(newMark);
        if (currentAddMarksId !== callId) {
          shouldAnimate = false;
        }
        newMark.shouldAnimate = false;
      }
    }
  }

  /**
   * マークをクリア
   */
  function clearMarks(): void {
    currentAddMarksId = null;
    marks.value = [];
  }

  // --- ライン管理 ---

  /**
   * ラインを追加（シナリオ用）
   */
  async function addLines(
    newLines: {
      fromPosition: Position;
      toPosition: Position;
      style?: "solid" | "dashed";
    }[],
    dialogueIndex: number,
    options?: { animate?: boolean },
  ): Promise<void> {
    const callId = ++addLinesIdCounter;
    currentAddLinesId = callId;
    let shouldAnimate = options?.animate !== false;

    for (let i = 0; i < newLines.length; i++) {
      if (currentAddLinesId !== callId) {
        shouldAnimate = false;
      }

      const lineData = newLines[i];
      const id = `${dialogueIndex}-line-${i}`;
      const newLine: Line = {
        id,
        fromPosition: lineData.fromPosition,
        toPosition: lineData.toPosition,
        style: lineData.style ?? "solid",
        placedAtDialogueIndex: dialogueIndex,
        shouldAnimate,
      };
      lines.value.push(newLine);

      if (shouldAnimate && onLineAddedCallback) {
        // oxlint-disable-next-line no-await-in-loop -- 順次アニメーション実行のため意図的
        await onLineAddedCallback(newLine);
        if (currentAddLinesId !== callId) {
          shouldAnimate = false;
        }
        newLine.shouldAnimate = false;
      }
    }
  }

  /**
   * ラインをクリア
   */
  function clearLines(): void {
    currentAddLinesId = null;
    lines.value = [];
  }

  /**
   * 石・マーク・ライン全てをリセット
   */
  function resetAll(): void {
    cancelOngoingAnimations();
    stones.value = [];
    marks.value = [];
    lines.value = [];
    resetBoard();
  }

  function setOnStoneAddedCallback(
    callback: OnStoneAddedCallback | null,
  ): void {
    onStoneAddedCallback = callback;
  }

  function setOnAnimationCancelCallback(
    callback: OnAnimationCancelCallback | null,
  ): void {
    onAnimationCancelCallback = callback;
  }

  function setOnMarkAddedCallback(callback: OnMarkAddedCallback | null): void {
    onMarkAddedCallback = callback;
  }

  function setOnLineAddedCallback(callback: OnLineAddedCallback | null): void {
    onLineAddedCallback = callback;
  }

  /**
   * 進行中のアニメーションをキャンセル
   * 連打時に呼び出され、全てのTweenを即座に完了させる
   */
  function cancelOngoingAnimations(): void {
    // 現在の呼び出しIDを無効化（進行中のaddStones/addMarks/addLinesをキャンセル）
    currentAddStonesId = null;
    currentAddMarksId = null;
    currentAddLinesId = null;

    // 進行中のTweenを即座に完了
    if (onAnimationCancelCallback) {
      onAnimationCancelCallback();
    }

    // shouldAnimateフラグも即座にfalseに
    for (const stone of stones.value) {
      if (stone.shouldAnimate) {
        stone.shouldAnimate = false;
      }
    }
    for (const mark of marks.value) {
      if (mark.shouldAnimate) {
        mark.shouldAnimate = false;
      }
    }
    for (const line of lines.value) {
      if (line.shouldAnimate) {
        line.shouldAnimate = false;
      }
    }
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
    setOnStoneAddedCallback,
    setOnAnimationCancelCallback,
    cancelOngoingAnimations,
    // マーク・ライン
    addMarks,
    clearMarks,
    addLines,
    clearLines,
    resetAll,
    setOnMarkAddedCallback,
    setOnLineAddedCallback,
  };
});
