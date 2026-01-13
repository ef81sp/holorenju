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

    it("コールバックが設定されていれば呼ばれる", async () => {
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
      it("stones配列に追加される", async () => {
        const store = useBoardStore();

        await store.addStones(
          [{ position: { row: 7, col: 7 }, color: "black" }],
          0,
        );

        expect(store.stones).toHaveLength(1);
        expect(store.stones[0].position).toEqual({ row: 7, col: 7 });
        expect(store.stones[0].color).toBe("black");
      });

      it("dialogueIndexが記録される", async () => {
        const store = useBoardStore();

        await store.addStones(
          [{ position: { row: 7, col: 7 }, color: "black" }],
          5,
        );

        expect(store.stones[0].placedAtDialogueIndex).toBe(5);
      });

      it("animate: trueで追加、コールバック完了後にshouldAnimate: false", async () => {
        const store = useBoardStore();
        const callback = vi.fn(() => Promise.resolve());
        store.setOnStoneAddedCallback(callback);

        await store.addStones(
          [{ position: { row: 7, col: 7 }, color: "black" }],
          0,
        );

        expect(callback).toHaveBeenCalledWith({ row: 7, col: 7 });
        expect(store.stones[0].shouldAnimate).toBe(false);
      });

      it("animate: falseの場合、shouldAnimate: false", async () => {
        const store = useBoardStore();
        const callback = vi.fn(() => Promise.resolve());
        store.setOnStoneAddedCallback(callback);

        await store.addStones(
          [{ position: { row: 7, col: 7 }, color: "black" }],
          0,
          { animate: false },
        );

        expect(callback).not.toHaveBeenCalled();
        expect(store.stones[0].shouldAnimate).toBe(false);
      });

      it("複数の石を順次追加できる", async () => {
        const store = useBoardStore();

        await store.addStones(
          [
            { position: { row: 7, col: 7 }, color: "black" },
            { position: { row: 7, col: 8 }, color: "white" },
          ],
          0,
        );

        expect(store.stones).toHaveLength(2);
        expect(store.stones[0].color).toBe("black");
        expect(store.stones[1].color).toBe("white");
      });
    });

    describe("removeStonesByDialogueIndex", () => {
      it("指定インデックスの石のみ削除", async () => {
        const store = useBoardStore();
        await store.addStones(
          [{ position: { row: 7, col: 7 }, color: "black" }],
          0,
        );
        await store.addStones(
          [{ position: { row: 7, col: 8 }, color: "white" }],
          1,
        );

        store.removeStonesByDialogueIndex(0);

        expect(store.stones).toHaveLength(1);
        expect(store.stones[0].placedAtDialogueIndex).toBe(1);
      });
    });

    describe("clearStones", () => {
      it("全ての石を削除", async () => {
        const store = useBoardStore();
        await store.addStones(
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
      it("marks配列に追加される", async () => {
        const store = useBoardStore();

        await store.addMarks(
          [{ positions: [{ row: 7, col: 7 }], markType: "circle" }],
          0,
        );

        expect(store.marks).toHaveLength(1);
        expect(store.marks[0].markType).toBe("circle");
      });

      it("アニメーションコールバックが呼ばれる", async () => {
        const store = useBoardStore();
        const callback = vi.fn(() => Promise.resolve());
        store.setOnMarkAddedCallback(callback);

        await store.addMarks(
          [{ positions: [{ row: 7, col: 7 }], markType: "cross" }],
          0,
        );

        expect(callback).toHaveBeenCalled();
      });

      it("labelが保存される", async () => {
        const store = useBoardStore();

        await store.addMarks(
          [{ positions: [{ row: 7, col: 7 }], markType: "circle", label: "A" }],
          0,
        );

        expect(store.marks[0].label).toBe("A");
      });
    });

    describe("clearMarks", () => {
      it("全てのマークを削除", async () => {
        const store = useBoardStore();
        await store.addMarks(
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
      it("lines配列に追加される", async () => {
        const store = useBoardStore();

        await store.addLines(
          [
            {
              fromPosition: { row: 0, col: 0 },
              toPosition: { row: 14, col: 14 },
            },
          ],
          0,
        );

        expect(store.lines).toHaveLength(1);
      });

      it("style未指定時はsolidがデフォルト", async () => {
        const store = useBoardStore();

        await store.addLines(
          [
            {
              fromPosition: { row: 0, col: 0 },
              toPosition: { row: 14, col: 14 },
            },
          ],
          0,
        );

        expect(store.lines[0].style).toBe("solid");
      });

      it("styleを指定できる", async () => {
        const store = useBoardStore();

        await store.addLines(
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
      });

      it("アニメーションコールバックが呼ばれる", async () => {
        const store = useBoardStore();
        const callback = vi.fn(() => Promise.resolve());
        store.setOnLineAddedCallback(callback);

        await store.addLines(
          [
            {
              fromPosition: { row: 0, col: 0 },
              toPosition: { row: 14, col: 14 },
            },
          ],
          0,
        );

        expect(callback).toHaveBeenCalled();
      });
    });

    describe("clearLines", () => {
      it("全てのラインを削除", async () => {
        const store = useBoardStore();
        await store.addLines(
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
    it("石・マーク・ライン・盤面全てをリセット", async () => {
      const store = useBoardStore();
      store.placeStone({ row: 7, col: 7 }, "black");
      await store.addStones(
        [{ position: { row: 7, col: 8 }, color: "white" }],
        0,
      );
      await store.addMarks(
        [{ positions: [{ row: 7, col: 9 }], markType: "circle" }],
        0,
      );
      await store.addLines(
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

  describe("cancelOngoingAnimations", () => {
    it("全てのshouldAnimateをfalseにする", async () => {
      const store = useBoardStore();

      // animate: falseで追加してからshouldAnimateを手動でtrueにする
      await store.addStones(
        [{ position: { row: 7, col: 7 }, color: "black" }],
        0,
        { animate: false },
      );
      store.stones[0].shouldAnimate = true;

      store.cancelOngoingAnimations();

      expect(store.stones[0].shouldAnimate).toBe(false);
    });

    it("onAnimationCancelCallbackを呼ぶ", () => {
      const store = useBoardStore();
      const callback = vi.fn();
      store.setOnAnimationCancelCallback(callback);

      store.cancelOngoingAnimations();

      expect(callback).toHaveBeenCalled();
    });

    it("marks, linesのshouldAnimateもfalseにする", async () => {
      const store = useBoardStore();

      await store.addMarks(
        [{ positions: [{ row: 7, col: 7 }], markType: "circle" }],
        0,
        { animate: false },
      );
      await store.addLines(
        [
          {
            fromPosition: { row: 0, col: 0 },
            toPosition: { row: 14, col: 14 },
          },
        ],
        0,
        { animate: false },
      );

      store.marks[0].shouldAnimate = true;
      store.lines[0].shouldAnimate = true;

      store.cancelOngoingAnimations();

      expect(store.marks[0].shouldAnimate).toBe(false);
      expect(store.lines[0].shouldAnimate).toBe(false);
    });
  });

  describe("レースコンディション対策", () => {
    it("addStones中にcancelOngoingAnimationsが呼ばれるとアニメーションがスキップされる", async () => {
      const store = useBoardStore();
      let resolveCallback: () => void;
      const callback = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveCallback = resolve;
          }),
      );
      store.setOnStoneAddedCallback(callback);

      // addStones開始（最初の石でawait中に止まる）
      const addPromise = store.addStones(
        [
          { position: { row: 7, col: 7 }, color: "black" },
          { position: { row: 7, col: 8 }, color: "white" },
        ],
        0,
      );

      // 最初の石のアニメーション中にキャンセル
      await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
      store.cancelOngoingAnimations();

      // 最初のコールバックを解決
      resolveCallback!();
      await addPromise;

      // 2番目の石はコールバックが呼ばれない（キャンセルされたため）
      expect(callback).toHaveBeenCalledTimes(1);
      // ただし石自体は追加される
      expect(store.stones).toHaveLength(2);
    });
  });
});
