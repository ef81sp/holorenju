/**
 * cpuGameStore テスト
 */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useBoardStore } from "./boardStore";
import { useCpuGameStore } from "./cpuGameStore";

describe("cpuGameStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("初期状態", () => {
    it("ゲームは開始されていない", () => {
      const store = useCpuGameStore();
      expect(store.isGameStarted).toBe(false);
    });

    it("ゲームは終了していない", () => {
      const store = useCpuGameStore();
      expect(store.isGameOver).toBe(false);
    });

    it("勝者はいない", () => {
      const store = useCpuGameStore();
      expect(store.winner).toBeNull();
    });

    it("着手履歴は空", () => {
      const store = useCpuGameStore();
      expect(store.moveHistory).toHaveLength(0);
    });
  });

  describe("startGame", () => {
    it("ゲームを開始できる", () => {
      const store = useCpuGameStore();
      store.startGame("medium", true);

      expect(store.isGameStarted).toBe(true);
      expect(store.difficulty).toBe("medium");
      expect(store.playerFirst).toBe(true);
    });

    it("プレイヤー先手の場合、プレイヤーの石色は黒", () => {
      const store = useCpuGameStore();
      store.startGame("medium", true);

      expect(store.playerColor).toBe("black");
      expect(store.cpuColor).toBe("white");
    });

    it("プレイヤー後手の場合、プレイヤーの石色は白", () => {
      const store = useCpuGameStore();
      store.startGame("medium", false);

      expect(store.playerColor).toBe("white");
      expect(store.cpuColor).toBe("black");
    });

    it("先手の場合、現在ターンは黒", () => {
      const store = useCpuGameStore();
      store.startGame("medium", true);

      expect(store.currentTurn).toBe("black");
    });
  });

  describe("addMove", () => {
    it("着手を追加できる", () => {
      const store = useCpuGameStore();
      useBoardStore();
      store.startGame("medium", true);

      store.addMove({ row: 7, col: 7 }, "black");

      expect(store.moveHistory).toHaveLength(1);
      expect(store.moveHistory[0]).toEqual({ row: 7, col: 7 });
      expect(store.currentTurn).toBe("white");
    });

    it("盤面に石が配置される", () => {
      const store = useCpuGameStore();
      const boardStore = useBoardStore();
      store.startGame("medium", true);

      store.addMove({ row: 7, col: 7 }, "black");

      expect(boardStore.board[7]?.[7]).toBe("black");
    });

    it("五連で勝利が判定される", () => {
      const store = useCpuGameStore();
      store.startGame("medium", true);

      // 黒の五連を作る
      store.addMove({ row: 7, col: 3 }, "black");
      store.addMove({ row: 8, col: 3 }, "white");
      store.addMove({ row: 7, col: 4 }, "black");
      store.addMove({ row: 8, col: 4 }, "white");
      store.addMove({ row: 7, col: 5 }, "black");
      store.addMove({ row: 8, col: 5 }, "white");
      store.addMove({ row: 7, col: 6 }, "black");
      store.addMove({ row: 8, col: 6 }, "white");
      store.addMove({ row: 7, col: 7 }, "black");

      expect(store.isGameOver).toBe(true);
      expect(store.winner).toBe("black");
    });
  });

  describe("undoMoves", () => {
    it("2手戻せる（待った機能）", () => {
      const store = useCpuGameStore();
      store.startGame("medium", true);

      store.addMove({ row: 7, col: 7 }, "black");
      store.addMove({ row: 7, col: 8 }, "white");
      store.addMove({ row: 8, col: 7 }, "black");
      store.addMove({ row: 8, col: 8 }, "white");

      expect(store.moveHistory).toHaveLength(4);

      store.undoMoves(2);

      expect(store.moveHistory).toHaveLength(2);
      expect(store.currentTurn).toBe("black");
    });

    it("履歴より多くの手数を戻そうとしても安全", () => {
      const store = useCpuGameStore();
      store.startGame("medium", true);

      store.addMove({ row: 7, col: 7 }, "black");

      store.undoMoves(10);

      expect(store.moveHistory).toHaveLength(0);
    });
  });

  describe("resetGame", () => {
    it("ゲームをリセットできる", () => {
      const store = useCpuGameStore();
      store.startGame("medium", true);
      store.addMove({ row: 7, col: 7 }, "black");

      store.resetGame();

      expect(store.isGameStarted).toBe(false);
      expect(store.isGameOver).toBe(false);
      expect(store.winner).toBeNull();
      expect(store.moveHistory).toHaveLength(0);
    });

    it("盤面もリセットされる", () => {
      const store = useCpuGameStore();
      const boardStore = useBoardStore();
      store.startGame("medium", true);
      store.addMove({ row: 7, col: 7 }, "black");

      store.resetGame();

      expect(boardStore.board[7]?.[7]).toBeNull();
    });
  });

  describe("moveCount", () => {
    it("手数を正しく計算する", () => {
      const store = useCpuGameStore();
      store.startGame("medium", true);

      expect(store.moveCount).toBe(0);

      store.addMove({ row: 7, col: 7 }, "black");
      expect(store.moveCount).toBe(1);

      store.addMove({ row: 7, col: 8 }, "white");
      expect(store.moveCount).toBe(2);
    });
  });

  describe("isPlayerTurn", () => {
    it("プレイヤー先手の場合、最初はプレイヤーのターン", () => {
      const store = useCpuGameStore();
      store.startGame("medium", true);

      expect(store.isPlayerTurn).toBe(true);
    });

    it("プレイヤー後手の場合、最初はCPUのターン", () => {
      const store = useCpuGameStore();
      store.startGame("medium", false);

      expect(store.isPlayerTurn).toBe(false);
    });

    it("ターンが交代する", () => {
      const store = useCpuGameStore();
      store.startGame("medium", true);

      store.addMove({ row: 7, col: 7 }, "black");
      expect(store.isPlayerTurn).toBe(false);

      store.addMove({ row: 7, col: 8 }, "white");
      expect(store.isPlayerTurn).toBe(true);
    });
  });
});
