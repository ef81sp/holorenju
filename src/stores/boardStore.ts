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

export const useBoardStore = defineStore("board", () => {
  // State
  const board = ref<BoardState>(createEmptyBoard());
  const lastPlacedStone = ref<{
    position: Position;
    color: StoneColor;
  } | null>(null);

  // シナリオ用の石配列（ダイアログインデックス追跡付き）
  const stones = ref<Stone[]>([]);

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

  // 呼び出しID管理（レースコンディション対策）
  let currentAddStonesId: number | null = null;
  let addStonesIdCounter = 0;

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

  /**
   * 進行中のアニメーションをキャンセル
   * 連打時に呼び出され、全てのTweenを即座に完了させる
   */
  function cancelOngoingAnimations(): void {
    // 現在の呼び出しIDを無効化（進行中のaddStonesをキャンセル）
    currentAddStonesId = null;

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
  }

  return {
    // State
    board,
    lastPlacedStone,
    stones,
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
  };
});
