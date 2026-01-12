import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useGameStore } from "./gameStore";

describe("gameStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("初期状態", () => {
    it("黒の手番から始まる", () => {
      const store = useGameStore();
      expect(store.currentTurn).toBe("black");
    });

    it("空の履歴から始まる", () => {
      const store = useGameStore();
      expect(store.moveHistory).toHaveLength(0);
    });

    it("ゲーム終了フラグがfalse", () => {
      const store = useGameStore();
      expect(store.isGameOver).toBe(false);
    });

    it("勝者がnull", () => {
      const store = useGameStore();
      expect(store.winner).toBeNull();
    });

    it("15x15の空盤面", () => {
      const store = useGameStore();
      expect(store.board).toHaveLength(15);
      for (const row of store.board) {
        expect(row).toHaveLength(15);
        for (const cell of row) {
          expect(cell).toBeNull();
        }
      }
    });
  });

  describe("placeStone", () => {
    it("空のマスに石を置ける", () => {
      const store = useGameStore();
      const result = store.placeStone({ row: 7, col: 7 });

      expect(result.success).toBe(true);
      expect(store.board[7][7]).toBe("black");
    });

    it("石を置いたら手番が交代する", () => {
      const store = useGameStore();
      store.placeStone({ row: 7, col: 7 });

      expect(store.currentTurn).toBe("white");
    });

    it("履歴に追加される", () => {
      const store = useGameStore();
      store.placeStone({ row: 7, col: 7 });

      expect(store.moveHistory).toHaveLength(1);
      expect(store.moveHistory[0]).toEqual({ row: 7, col: 7 });
    });

    it("すでに石があるマスには置けない", () => {
      const store = useGameStore();
      store.placeStone({ row: 7, col: 7 });
      store.placeStone({ row: 7, col: 8 }); // 白の手番

      const result = store.placeStone({ row: 7, col: 7 }); // 黒の手番、同じ場所

      expect(result.success).toBe(false);
      expect(result.message).toBe("すでに石が置かれています");
    });

    it("ゲーム終了後は石を置けない", () => {
      const store = useGameStore();
      // 黒が5つ並べて勝利する配置
      store.placeStone({ row: 7, col: 3 }); // 黒
      store.placeStone({ row: 8, col: 3 }); // 白
      store.placeStone({ row: 7, col: 4 }); // 黒
      store.placeStone({ row: 8, col: 4 }); // 白
      store.placeStone({ row: 7, col: 5 }); // 黒
      store.placeStone({ row: 8, col: 5 }); // 白
      store.placeStone({ row: 7, col: 6 }); // 黒
      store.placeStone({ row: 8, col: 6 }); // 白
      store.placeStone({ row: 7, col: 7 }); // 黒 - 5連！

      expect(store.isGameOver).toBe(true);

      const result = store.placeStone({ row: 0, col: 0 });
      expect(result.success).toBe(false);
      expect(result.message).toBe("ゲームは終了しています");
    });

    it("5連で勝利となる", () => {
      const store = useGameStore();
      // 黒が5つ並べて勝利する配置
      store.placeStone({ row: 7, col: 3 }); // 黒
      store.placeStone({ row: 8, col: 3 }); // 白
      store.placeStone({ row: 7, col: 4 }); // 黒
      store.placeStone({ row: 8, col: 4 }); // 白
      store.placeStone({ row: 7, col: 5 }); // 黒
      store.placeStone({ row: 8, col: 5 }); // 白
      store.placeStone({ row: 7, col: 6 }); // 黒
      store.placeStone({ row: 8, col: 6 }); // 白
      const result = store.placeStone({ row: 7, col: 7 }); // 黒 - 5連！

      expect(result.success).toBe(true);
      expect(result.message).toBe("黒の勝利！");
      expect(store.isGameOver).toBe(true);
      expect(store.winner).toBe("black");
    });
  });

  // FIXME: 禁じ手のロジックは複雑で、テストケースが実際のルールを正確に反映しているか要確認
  describe("禁じ手", () => {
    it("三三は禁じ手", () => {
      const store = useGameStore();
      // 三三になる配置を作る
      // 横の三: (7,6), (7,7), (7,8) - 中央を空ける
      // 縦の三: (6,7), (7,7), (8,7) - 中央を空ける
      store.placeStone({ row: 7, col: 5 }); // 黒
      store.placeStone({ row: 0, col: 0 }); // 白
      store.placeStone({ row: 7, col: 6 }); // 黒
      store.placeStone({ row: 0, col: 1 }); // 白
      store.placeStone({ row: 5, col: 7 }); // 黒
      store.placeStone({ row: 0, col: 2 }); // 白
      store.placeStone({ row: 6, col: 7 }); // 黒
      store.placeStone({ row: 0, col: 3 }); // 白

      // (7,7)に置くと三三になる
      const result = store.placeStone({ row: 7, col: 7 });

      expect(result.success).toBe(false);
      expect(result.message).toBe("三三の禁じ手です");
    });

    it("長連は禁じ手", () => {
      const store = useGameStore();
      // setBoardで直接盤面を設定
      // x x _ x x x の形を作り、_の位置に置くと6連になる
      const board = store.board.map((row) => [...row]);
      board[7][2] = "black";
      board[7][3] = "black";
      // (7,4)は空
      board[7][5] = "black";
      board[7][6] = "black";
      board[7][7] = "black";
      store.setBoard(board);

      // (7,4)に置くと6連（長連）になる
      const result = store.placeStone({ row: 7, col: 4 });

      expect(result.success).toBe(false);
      expect(result.message).toBe("長連の禁じ手です");
    });
  });

  describe("resetBoard", () => {
    it("盤面をリセットする", () => {
      const store = useGameStore();
      store.placeStone({ row: 7, col: 7 });
      store.placeStone({ row: 7, col: 8 });

      store.resetBoard();

      expect(store.board[7][7]).toBeNull();
      expect(store.board[7][8]).toBeNull();
    });

    it("手番を黒に戻す", () => {
      const store = useGameStore();
      store.placeStone({ row: 7, col: 7 });

      store.resetBoard();

      expect(store.currentTurn).toBe("black");
    });

    it("履歴をクリアする", () => {
      const store = useGameStore();
      store.placeStone({ row: 7, col: 7 });

      store.resetBoard();

      expect(store.moveHistory).toHaveLength(0);
    });

    it("ゲーム終了状態をリセットする", () => {
      const store = useGameStore();
      // 黒が勝利する配置
      store.placeStone({ row: 7, col: 3 });
      store.placeStone({ row: 8, col: 3 });
      store.placeStone({ row: 7, col: 4 });
      store.placeStone({ row: 8, col: 4 });
      store.placeStone({ row: 7, col: 5 });
      store.placeStone({ row: 8, col: 5 });
      store.placeStone({ row: 7, col: 6 });
      store.placeStone({ row: 8, col: 6 });
      store.placeStone({ row: 7, col: 7 });

      store.resetBoard();

      expect(store.isGameOver).toBe(false);
      expect(store.winner).toBeNull();
    });
  });

  describe("undoMove", () => {
    it("最後の手を取り消せる", () => {
      const store = useGameStore();
      store.placeStone({ row: 7, col: 7 });

      const result = store.undoMove();

      expect(result).toBe(true);
      expect(store.board[7][7]).toBeNull();
    });

    it("手番が戻る", () => {
      const store = useGameStore();
      store.placeStone({ row: 7, col: 7 }); // 黒 → 白の手番

      store.undoMove();

      expect(store.currentTurn).toBe("black");
    });

    it("履歴から削除される", () => {
      const store = useGameStore();
      store.placeStone({ row: 7, col: 7 });
      store.placeStone({ row: 7, col: 8 });

      store.undoMove();

      expect(store.moveHistory).toHaveLength(1);
      expect(store.moveHistory[0]).toEqual({ row: 7, col: 7 });
    });

    it("履歴が空の場合はfalseを返す", () => {
      const store = useGameStore();

      const result = store.undoMove();

      expect(result).toBe(false);
    });

    it("ゲーム終了後もundoできる", () => {
      const store = useGameStore();
      // 黒が勝利する配置
      store.placeStone({ row: 7, col: 3 });
      store.placeStone({ row: 8, col: 3 });
      store.placeStone({ row: 7, col: 4 });
      store.placeStone({ row: 8, col: 4 });
      store.placeStone({ row: 7, col: 5 });
      store.placeStone({ row: 8, col: 5 });
      store.placeStone({ row: 7, col: 6 });
      store.placeStone({ row: 8, col: 6 });
      store.placeStone({ row: 7, col: 7 }); // 勝利

      expect(store.isGameOver).toBe(true);

      store.undoMove();

      expect(store.isGameOver).toBe(false);
      expect(store.winner).toBeNull();
      expect(store.board[7][7]).toBeNull();
    });
  });

  describe("gameState getter", () => {
    it("現在のゲーム状態を返す", () => {
      const store = useGameStore();
      store.placeStone({ row: 7, col: 7 });

      const state = store.gameState;

      expect(state.board[7][7]).toBe("black");
      expect(state.currentTurn).toBe("white");
      expect(state.isGameOver).toBe(false);
      expect(state.moveHistory).toHaveLength(1);
      expect(state.winner).toBeNull();
    });
  });
});
