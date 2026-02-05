/**
 * CPU対戦ゲーム状態管理ストア
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { CpuDifficulty } from "@/types/cpu";
import type { Position, StoneColor } from "@/types/game";

import { checkWin } from "@/logic/renjuRules";

import { useBoardStore } from "./boardStore";

export const useCpuGameStore = defineStore("cpuGame", () => {
  const boardStore = useBoardStore();

  // ========== State ==========
  /** 難易度 */
  const difficulty = ref<CpuDifficulty>("medium");
  /** プレイヤーが先手かどうか */
  const playerFirst = ref(true);
  /** 着手履歴 */
  const moveHistory = ref<Position[]>([]);
  /** ゲーム開始フラグ */
  const isGameStarted = ref(false);
  /** ゲーム終了フラグ */
  const isGameOver = ref(false);
  /** 勝者 */
  const winner = ref<StoneColor>(null);
  /** 現在のターン */
  const currentTurn = ref<"black" | "white">("black");

  // ========== Computed ==========
  /** プレイヤーの石色 */
  const playerColor = computed<"black" | "white">(() =>
    playerFirst.value ? "black" : "white",
  );

  /** CPUの石色 */
  const cpuColor = computed<"black" | "white">(() =>
    playerFirst.value ? "white" : "black",
  );

  /** 手数 */
  const moveCount = computed(() => moveHistory.value.length);

  /** プレイヤーのターンかどうか */
  const isPlayerTurn = computed(() => currentTurn.value === playerColor.value);

  /** 盤面（boardStoreから参照） */
  const board = computed(() => boardStore.board);

  /**
   * 最後のCPU着手位置
   * CPUのターンでない場合（=プレイヤーのターン）かつ履歴があれば、最後の手はCPUの手
   */
  const lastCpuMovePosition = computed<Position | null>(() => {
    if (moveHistory.value.length === 0) {
      return null;
    }
    // プレイヤーのターン = 直前はCPUの手
    if (isPlayerTurn.value) {
      return moveHistory.value[moveHistory.value.length - 1] ?? null;
    }
    return null;
  });

  // ========== Actions ==========

  /**
   * ゲームを開始
   */
  function startGame(diff: CpuDifficulty, first: boolean): void {
    difficulty.value = diff;
    playerFirst.value = first;
    isGameStarted.value = true;
    isGameOver.value = false;
    winner.value = null;
    moveHistory.value = [];
    currentTurn.value = "black";
    boardStore.resetBoard();
  }

  /**
   * 着手を追加
   */
  function addMove(position: Position, color: "black" | "white"): void {
    // 盤面に石を配置
    boardStore.placeStone(position, color, { animate: true });

    // 履歴に追加
    moveHistory.value.push(position);

    // 勝利判定
    if (checkWin(boardStore.board, position, color)) {
      isGameOver.value = true;
      winner.value = color;
      return;
    }

    // ターン交代
    currentTurn.value = currentTurn.value === "black" ? "white" : "black";
  }

  /**
   * 指定手数分戻す（待った機能）
   */
  function undoMoves(count: number): void {
    const actualCount = Math.min(count, moveHistory.value.length);

    for (let i = 0; i < actualCount; i++) {
      const lastMove = moveHistory.value.pop();
      if (lastMove) {
        boardStore.removeStone(lastMove);
      }
    }

    // ターンを調整
    if (actualCount % 2 === 1) {
      currentTurn.value = currentTurn.value === "black" ? "white" : "black";
    }

    // ゲーム終了をリセット
    isGameOver.value = false;
    winner.value = null;
  }

  /**
   * ゲームをリセット
   */
  function resetGame(): void {
    isGameStarted.value = false;
    isGameOver.value = false;
    winner.value = null;
    moveHistory.value = [];
    currentTurn.value = "black";
    boardStore.resetBoard();
  }

  /**
   * ゲームを終了（結果を設定）
   */
  function endGame(result: StoneColor): void {
    isGameOver.value = true;
    winner.value = result;
  }

  return {
    // State
    difficulty,
    playerFirst,
    moveHistory,
    isGameStarted,
    isGameOver,
    winner,
    currentTurn,
    // Computed
    playerColor,
    cpuColor,
    moveCount,
    isPlayerTurn,
    board,
    lastCpuMovePosition,
    // Actions
    startGame,
    addMove,
    undoMoves,
    resetGame,
    endGame,
  };
});
