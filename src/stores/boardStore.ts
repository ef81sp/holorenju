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

export const useBoardStore = defineStore("board", () => {
  // State
  const board = ref<BoardState>(createEmptyBoard());

  // Actions
  function placeStone(
    position: Position,
    color: StoneColor,
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
  }

  function resetBoard(): void {
    board.value = createEmptyBoard();
  }

  return {
    // State
    board,
    // Actions
    placeStone,
    removeStone,
    setBoard,
    resetBoard,
  };
});
