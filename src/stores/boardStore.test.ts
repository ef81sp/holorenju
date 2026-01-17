import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBoardStore } from "./boardStore";

describe("boardStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("初期状態", () => {
    it("15x15の空盤面", () => {
      const store = useBoardStore();

      expect(store.board).toHaveLength(15);
      expect(store.board[0]).toHaveLength(15);
      expect(
        store.board.every((row) => row.every((cell) => cell === null)),
      ).toBe(true);
    });

    it("lastPlacedStoneがnull", () => {
      const store = useBoardStore();
      expect(store.lastPlacedStone).toBeNull();
    });

    it("stones配列が空", () => {
      const store = useBoardStore();
      expect(store.stones).toEqual([]);
    });

    it("marks配列が空", () => {
      const store = useBoardStore();
      expect(store.marks).toEqual([]);
    });

    it("lines配列が空", () => {
      const store = useBoardStore();
      expect(store.lines).toEqual([]);
    });
  });

  describe("placeStone", () => {
    it("空のマスに石を置ける", () => {
      const store = useBoardStore();

      const result = store.placeStone({ row: 7, col: 7 }, "black");

      expect(result.success).toBe(true);
      expect(store.board[7][7]).toBe("black");
    });

    it("すでに石があるマスには置けない", () => {
      const store = useBoardStore();
      store.placeStone({ row: 7, col: 7 }, "black");

      const result = store.placeStone({ row: 7, col: 7 }, "white");

      expect(result.success).toBe(false);
      expect(result.message).toBe("すでに石が置かれています");
      expect(store.board[7][7]).toBe("black"); // 変わらない
    });

    it("lastPlacedStoneを更新する", () => {
      const store = useBoardStore();

      store.placeStone({ row: 7, col: 7 }, "black");

      expect(store.lastPlacedStone).toEqual({
        position: { row: 7, col: 7 },
        color: "black",
      });
    });

    it("コールバックが設定されていれば呼ばれる", () => {
      const store = useBoardStore();
      const callback = vi.fn(() => Promise.resolve());
      store.setOnStonePlacedCallback(callback);

      store.placeStone({ row: 7, col: 7 }, "black");

      expect(callback).toHaveBeenCalledWith({ row: 7, col: 7 }, "black");
    });

    it("animate: falseの場合コールバックはスキップ", () => {
      const store = useBoardStore();
      const callback = vi.fn(() => Promise.resolve());
      store.setOnStonePlacedCallback(callback);

      store.placeStone({ row: 7, col: 7 }, "black", { animate: false });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("removeStone", () => {
    it("石を削除できる", () => {
      const store = useBoardStore();
      store.placeStone({ row: 7, col: 7 }, "black");

      const result = store.removeStone({ row: 7, col: 7 });

      expect(result.success).toBe(true);
      expect(store.board[7][7]).toBeNull();
    });
  });

  describe("setBoard", () => {
    it("盤面全体を設定できる", () => {
      const store = useBoardStore();
      const newBoard = Array(15)
        .fill(null)
        .map(() => Array(15).fill(null));
      newBoard[0][0] = "black";
      newBoard[14][14] = "white";

      store.setBoard(newBoard);

      expect(store.board[0][0]).toBe("black");
      expect(store.board[14][14]).toBe("white");
    });

    it("lastPlacedStoneをクリアする", () => {
      const store = useBoardStore();
      store.placeStone({ row: 7, col: 7 }, "black");
      expect(store.lastPlacedStone).not.toBeNull();

      const newBoard = Array(15)
        .fill(null)
        .map(() => Array(15).fill(null));
      store.setBoard(newBoard);

      expect(store.lastPlacedStone).toBeNull();
    });
  });

  describe("resetBoard", () => {
    it("盤面を空にする", () => {
      const store = useBoardStore();
      store.placeStone({ row: 7, col: 7 }, "black");

      store.resetBoard();

      expect(store.board[7][7]).toBeNull();
    });

    it("lastPlacedStoneをクリアする", () => {
      const store = useBoardStore();
      store.placeStone({ row: 7, col: 7 }, "black");

      store.resetBoard();

      expect(store.lastPlacedStone).toBeNull();
    });
  });

  describe("シナリオ用石管理", () => {
    describe("addStones", () => {
      it("stones配列に追加され、追加された石を返す", () => {
        const store = useBoardStore();

        const added = store.addStones(
          [{ position: { row: 7, col: 7 }, color: "black" }],
          0,
        );

        expect(store.stones).toHaveLength(1);
        expect(store.stones[0].position).toEqual({ row: 7, col: 7 });
        expect(store.stones[0].color).toBe("black");
        expect(added).toHaveLength(1);
        expect(added[0].position).toEqual({ row: 7, col: 7 });
      });

      it("dialogueIndexが記録される", () => {
        const store = useBoardStore();

        const added = store.addStones(
          [{ position: { row: 7, col: 7 }, color: "black" }],
          5,
        );

        expect(store.stones[0].placedAtDialogueIndex).toBe(5);
        expect(added[0].placedAtDialogueIndex).toBe(5);
      });

      it("複数の石を同時に追加できる", () => {
        const store = useBoardStore();

        const added = store.addStones(
          [
            { position: { row: 7, col: 7 }, color: "black" },
            { position: { row: 7, col: 8 }, color: "white" },
          ],
          0,
        );

        expect(store.stones).toHaveLength(2);
        expect(store.stones[0].color).toBe("black");
        expect(store.stones[1].color).toBe("white");
        expect(added).toHaveLength(2);
      });

      it("ユニークなIDが生成される", () => {
        const store = useBoardStore();

        const added = store.addStones(
          [
            { position: { row: 7, col: 7 }, color: "black" },
            { position: { row: 7, col: 8 }, color: "white" },
          ],
          0,
        );

        expect(added[0].id).toBe("0-7-7");
        expect(added[1].id).toBe("0-7-8");
      });
    });

    describe("removeStonesByDialogueIndex", () => {
      it("指定インデックスの石のみ削除", () => {
        const store = useBoardStore();
        store.addStones([{ position: { row: 7, col: 7 }, color: "black" }], 0);
        store.addStones([{ position: { row: 7, col: 8 }, color: "white" }], 1);

        store.removeStonesByDialogueIndex(0);

        expect(store.stones).toHaveLength(1);
        expect(store.stones[0].placedAtDialogueIndex).toBe(1);
      });
    });

    describe("clearStones", () => {
      it("全ての石を削除", () => {
        const store = useBoardStore();
        store.addStones(
          [
            { position: { row: 7, col: 7 }, color: "black" },
            { position: { row: 7, col: 8 }, color: "white" },
          ],
          0,
        );

        store.clearStones();

        expect(store.stones).toEqual([]);
      });
    });
  });

  describe("マーク管理", () => {
    describe("addMarks", () => {
      it("marks配列に追加され、追加されたマークを返す", () => {
        const store = useBoardStore();

        const added = store.addMarks(
          [{ positions: [{ row: 7, col: 7 }], markType: "circle" }],
          0,
        );

        expect(store.marks).toHaveLength(1);
        expect(store.marks[0].markType).toBe("circle");
        expect(added).toHaveLength(1);
        expect(added[0].markType).toBe("circle");
      });

      it("labelが保存される", () => {
        const store = useBoardStore();

        const added = store.addMarks(
          [{ positions: [{ row: 7, col: 7 }], markType: "circle", label: "A" }],
          0,
        );

        expect(store.marks[0].label).toBe("A");
        expect(added[0].label).toBe("A");
      });

      it("ユニークなIDが生成される", () => {
        const store = useBoardStore();

        const added = store.addMarks(
          [
            { positions: [{ row: 7, col: 7 }], markType: "circle" },
            { positions: [{ row: 8, col: 8 }], markType: "cross" },
          ],
          0,
        );

        expect(added[0].id).toBe("0-mark-0");
        expect(added[1].id).toBe("0-mark-1");
      });
    });

    describe("clearMarks", () => {
      it("全てのマークを削除", () => {
        const store = useBoardStore();
        store.addMarks(
          [{ positions: [{ row: 7, col: 7 }], markType: "circle" }],
          0,
        );

        store.clearMarks();

        expect(store.marks).toEqual([]);
      });
    });
  });

  describe("ライン管理", () => {
    describe("addLines", () => {
      it("lines配列に追加され、追加されたラインを返す", () => {
        const store = useBoardStore();

        const added = store.addLines(
          [
            {
              fromPosition: { row: 0, col: 0 },
              toPosition: { row: 14, col: 14 },
            },
          ],
          0,
        );

        expect(store.lines).toHaveLength(1);
        expect(added).toHaveLength(1);
      });

      it("style未指定時はsolidがデフォルト", () => {
        const store = useBoardStore();

        const added = store.addLines(
          [
            {
              fromPosition: { row: 0, col: 0 },
              toPosition: { row: 14, col: 14 },
            },
          ],
          0,
        );

        expect(store.lines[0].style).toBe("solid");
        expect(added[0].style).toBe("solid");
      });

      it("styleを指定できる", () => {
        const store = useBoardStore();

        const added = store.addLines(
          [
            {
              fromPosition: { row: 0, col: 0 },
              toPosition: { row: 14, col: 14 },
              style: "dashed",
            },
          ],
          0,
        );

        expect(store.lines[0].style).toBe("dashed");
        expect(added[0].style).toBe("dashed");
      });

      it("ユニークなIDが生成される", () => {
        const store = useBoardStore();

        const added = store.addLines(
          [
            {
              fromPosition: { row: 0, col: 0 },
              toPosition: { row: 14, col: 14 },
            },
            {
              fromPosition: { row: 1, col: 1 },
              toPosition: { row: 13, col: 13 },
            },
          ],
          0,
        );

        expect(added[0].id).toBe("0-line-0");
        expect(added[1].id).toBe("0-line-1");
      });
    });

    describe("clearLines", () => {
      it("全てのラインを削除", () => {
        const store = useBoardStore();
        store.addLines(
          [
            {
              fromPosition: { row: 0, col: 0 },
              toPosition: { row: 14, col: 14 },
            },
          ],
          0,
        );

        store.clearLines();

        expect(store.lines).toEqual([]);
      });
    });
  });

  describe("resetAll", () => {
    it("石・マーク・ライン・盤面全てをリセット", () => {
      const store = useBoardStore();
      store.placeStone({ row: 7, col: 7 }, "black");
      store.addStones([{ position: { row: 7, col: 8 }, color: "white" }], 0);
      store.addMarks(
        [{ positions: [{ row: 7, col: 9 }], markType: "circle" }],
        0,
      );
      store.addLines(
        [
          {
            fromPosition: { row: 0, col: 0 },
            toPosition: { row: 14, col: 14 },
          },
        ],
        0,
      );

      store.resetAll();

      expect(store.board[7][7]).toBeNull();
      expect(store.stones).toEqual([]);
      expect(store.marks).toEqual([]);
      expect(store.lines).toEqual([]);
      expect(store.lastPlacedStone).toBeNull();
    });
  });
});
