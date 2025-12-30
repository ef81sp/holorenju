/**
 * ゲーム状態管理ストア
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { BoardState, GameState, Position, StoneColor } from "@/types/game";

import {
  checkForbiddenMove,
  checkWin,
  createEmptyBoard,
} from "@/logic/renjuRules";

export const useGameStore = defineStore("game", () => {
  // State
  const board = ref<BoardState>(createEmptyBoard());
  const currentTurn = ref<StoneColor>("black");
  const moveHistory = ref<Position[]>([]);
  const isGameOver = ref(false);
  const winner = ref<StoneColor>(null);

  // Getters
  const gameState = computed<GameState>(() => ({
    board: board.value,
    currentTurn: currentTurn.value,
    isGameOver: isGameOver.value,
    moveHistory: moveHistory.value,
    winner: winner.value,
  }));

  // Actions
  function placeStone(position: Position): {
    success: boolean;
    message?: string;
  } {
    // すでにゲーム終了している場合
    if (isGameOver.value) {
      return { message: "ゲームは終了しています", success: false };
    }

    // すでに石が置かれている
    if (board.value[position.row]?.[position.col] !== null) {
      return { message: "すでに石が置かれています", success: false };
    }

    // 黒石の場合は禁じ手チェック
    if (currentTurn.value === "black") {
      const forbiddenResult = checkForbiddenMove(
        board.value,
        position.row,
        position.col,
      );
      if (forbiddenResult.isForbidden) {
        const messages: Record<string, string> = {
          "double-four": "四四の禁じ手です",
          "double-three": "三三の禁じ手です",
          overline: "長連の禁じ手です",
        };
        const messageText =
          (forbiddenResult.type && messages[forbiddenResult.type]) ||
          "禁じ手です";
        return {
          message: messageText,
          success: false,
        };
      }
    }

    // 石を配置
    const row = board.value[position.row];
    if (row) {
      row[position.col] = currentTurn.value;
    }
    moveHistory.value.push(position);

    // 勝利判定
    if (checkWin(board.value, position, currentTurn.value)) {
      isGameOver.value = true;
      winner.value = currentTurn.value;
      return {
        message: `${currentTurn.value === "black" ? "黒" : "白"}の勝利！`,
        success: true,
      };
    }

    // ターン交代
    currentTurn.value = currentTurn.value === "black" ? "white" : "black";

    return { success: true };
  }

  function resetBoard(): void {
    board.value = createEmptyBoard();
    currentTurn.value = "black";
    moveHistory.value = [];
    isGameOver.value = false;
    winner.value = null;
  }

  function setBoard(newBoard: BoardState): void {
    board.value = newBoard.map((row: StoneColor[]) => [...row]);
  }

  function undoMove(): boolean {
    if (moveHistory.value.length === 0) {
      return false;
    }

    const lastMove = moveHistory.value.pop();
    if (!lastMove) {
      return false;
    }
    const row = board.value[lastMove.row];
    if (row) {
      row[lastMove.col] = null;
    }
    currentTurn.value = currentTurn.value === "black" ? "white" : "black";
    isGameOver.value = false;
    winner.value = null;

    return true;
  }

  return {
    // State
    board,
    currentTurn,
    moveHistory,
    isGameOver,
    winner,
    // Getters
    gameState,
    // Actions
    placeStone,
    resetBoard,
    setBoard,
    undoMove,
  };
});
