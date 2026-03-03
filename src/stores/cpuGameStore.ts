/**
 * CPU対戦ゲーム状態管理ストア
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { CpuDifficulty } from "@/types/cpu";
import type { Position, StoneColor } from "@/types/game";

import { getJushuPositions } from "@/logic/cpu/opening";
import { checkWin } from "@/logic/renjuRules";

import { useBoardStore } from "./boardStore";

export interface OpeningOption {
  /** 珠型名 */
  jushu: string;
  /** 方向固定フラグ（true: 基準方向、false: ランダム） */
  fixedDirection: boolean;
}

export const useCpuGameStore = defineStore("cpuGame", () => {
  const boardStore = useBoardStore();

  // ========== State ==========
  /** 難易度 */
  const difficulty = ref<CpuDifficulty>("medium");
  /** プレイヤーが先手かどうか */
  const playerFirst = ref(true);
  /** 着手履歴 */
  const moveHistory = ref<Position[]>([]);
  /** 開局で自動配置した手数（珠型固定時は3、なしは0） */
  const openingMoveCount = ref(0);
  /** 使用中の珠型名 */
  const jushuName = ref<string | null>(null);
  /** ゲーム開始フラグ */
  const isGameStarted = ref(false);
  /** ゲーム終了フラグ */
  const isGameOver = ref(false);
  /** 勝者 */
  const winner = ref<StoneColor>(null);

  // ========== Computed ==========
  /** 現在のターン（着手数から決定的に導出） */
  const currentTurn = computed<"black" | "white">(() =>
    moveHistory.value.length % 2 === 0 ? "black" : "white",
  );
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

  /** 待ったが可能かどうか（開局手数を下回らない） */
  const canUndo = computed(
    () => moveHistory.value.length - openingMoveCount.value >= 2,
  );

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
  function startGame(
    diff: CpuDifficulty,
    first: boolean,
    opening?: OpeningOption,
  ): void {
    difficulty.value = diff;
    playerFirst.value = first;
    isGameStarted.value = true;
    isGameOver.value = false;
    winner.value = null;
    moveHistory.value = [];
    boardStore.resetAll();

    if (opening) {
      const positions = getJushuPositions(
        opening.jushu,
        opening.fixedDirection,
      );
      if (positions) {
        const [p0, p1, p2] = positions;
        boardStore.placeStone(p0, "black", { animate: false });
        boardStore.placeStone(p1, "white", { animate: false });
        boardStore.placeStone(p2, "black", { animate: false });
        moveHistory.value.push(...positions);
        openingMoveCount.value = 3;
        jushuName.value = opening.jushu;
      } else {
        openingMoveCount.value = 0;
        jushuName.value = null;
      }
    } else {
      openingMoveCount.value = 0;
      jushuName.value = null;
    }
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
    }
  }

  /**
   * 指定手数分戻す（待った機能）
   */
  function undoMoves(count: number): void {
    const undoableCount = moveHistory.value.length - openingMoveCount.value;
    const actualCount = Math.min(count, undoableCount);

    for (let i = 0; i < actualCount; i++) {
      const lastMove = moveHistory.value.pop();
      if (lastMove) {
        boardStore.removeStone(lastMove);
      }
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
    openingMoveCount.value = 0;
    jushuName.value = null;
    boardStore.resetAll();
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
    openingMoveCount,
    jushuName,
    isGameStarted,
    isGameOver,
    winner,
    // Computed
    currentTurn,
    playerColor,
    cpuColor,
    moveCount,
    isPlayerTurn,
    canUndo,
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
