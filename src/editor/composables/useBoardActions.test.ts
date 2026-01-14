import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type {
  DemoSection,
  DemoDialogue,
  BoardAction,
  PlaceMoveAction,
  LineAction,
  SetBoardAction,
  MarkAction,
} from "@/types/scenario";

import { useBoardActions } from "./useBoardActions";

describe("useBoardActions", () => {
  // モックセクションとダイアログ
  // eslint-disable-next-line init-declarations
  let mockSection: DemoSection;
  // eslint-disable-next-line init-declarations
  let getCurrentSection: Mock<() => DemoSection | null>;
  // eslint-disable-next-line init-declarations
  let updateDialogue: Mock<
    (index: number, updates: Partial<DemoDialogue>) => void
  >;

  // 初期ダイアログを作成するヘルパー
  const createDialogue = (boardActions: BoardAction[] = []): DemoDialogue => ({
    id: "dialogue-1",
    character: "fubuki",
    text: [],
    emotion: 0,
    boardActions,
  });

  beforeEach(() => {
    mockSection = {
      id: "section-1",
      type: "demo",
      title: "Test Section",
      initialBoard: Array(15).fill("-".repeat(15)),
      dialogues: [createDialogue()],
    };

    getCurrentSection = vi.fn(() => mockSection);
    updateDialogue = vi.fn((index, updates) => {
      // モックの状態も更新（テストの連続性のため）
      Object.assign(mockSection.dialogues[index], updates);
    });
  });

  describe("createBoardAction", () => {
    it("place: デフォルト値で作成", () => {
      const { createBoardAction } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      const action = createBoardAction("place");

      expect(action).toEqual({
        type: "place",
        position: { row: 0, col: 0 },
        color: "black",
        highlight: false,
      });
    });

    it("remove: デフォルト値で作成", () => {
      const { createBoardAction } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      const action = createBoardAction("remove");

      expect(action).toEqual({
        type: "remove",
        position: { row: 0, col: 0 },
      });
    });

    it("setBoard: 15x15空盤面で作成", () => {
      const { createBoardAction } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      const action = createBoardAction("setBoard");

      expect(action.type).toBe("setBoard");
      if (action.type === "setBoard") {
        expect(action.board).toHaveLength(15);
        expect(action.board[0]).toBe("-".repeat(15));
      }
    });

    it("mark: 空positions、circle", () => {
      const { createBoardAction } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      const action = createBoardAction("mark");

      expect(action).toEqual({
        type: "mark",
        positions: [],
        markType: "circle",
      });
    });

    it("line: デフォルト座標、solid", () => {
      const { createBoardAction } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      const action = createBoardAction("line");

      expect(action).toEqual({
        type: "line",
        fromPosition: { row: 0, col: 0 },
        toPosition: { row: 0, col: 0 },
        action: "draw",
        style: "solid",
      });
    });

    it("resetAll: typeのみ", () => {
      const { createBoardAction } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      const action = createBoardAction("resetAll");

      expect(action).toEqual({
        type: "resetAll",
      });
    });
  });

  describe("addBoardAction", () => {
    it("dialogueのboardActionsに追加", () => {
      const { addBoardAction } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      addBoardAction(0);

      expect(updateDialogue).toHaveBeenCalledWith(0, {
        boardActions: [
          {
            type: "place",
            position: { row: 0, col: 0 },
            color: "black",
            highlight: false,
          },
        ],
      });
    });

    it("セクションがnullなら何もしない", () => {
      getCurrentSection = vi.fn(() => null);
      const { addBoardAction } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      addBoardAction(0);

      expect(updateDialogue).not.toHaveBeenCalled();
    });

    it("存在しないダイアログインデックスなら何もしない", () => {
      const { addBoardAction } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      addBoardAction(99);

      expect(updateDialogue).not.toHaveBeenCalled();
    });
  });

  describe("removeBoardAction", () => {
    it("指定インデックスのアクションを削除", () => {
      mockSection.dialogues[0] = createDialogue([
        { type: "place", position: { row: 0, col: 0 }, color: "black" },
        { type: "place", position: { row: 1, col: 1 }, color: "white" },
      ]);

      const { removeBoardAction } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      removeBoardAction(0, 0);

      expect(updateDialogue).toHaveBeenCalledWith(0, {
        boardActions: [
          { type: "place", position: { row: 1, col: 1 }, color: "white" },
        ],
      });
    });
  });

  describe("moveBoardAction", () => {
    it("アクションの順序を変更", () => {
      mockSection.dialogues[0] = createDialogue([
        { type: "place", position: { row: 0, col: 0 }, color: "black" },
        { type: "place", position: { row: 1, col: 1 }, color: "white" },
        { type: "place", position: { row: 2, col: 2 }, color: "black" },
      ]);

      const { moveBoardAction } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      // index 0 を index 2 に移動
      moveBoardAction(0, 0, 2);

      expect(updateDialogue).toHaveBeenCalledWith(0, {
        boardActions: [
          { type: "place", position: { row: 1, col: 1 }, color: "white" },
          { type: "place", position: { row: 2, col: 2 }, color: "black" },
          { type: "place", position: { row: 0, col: 0 }, color: "black" },
        ],
      });
    });
  });

  describe("updateBoardActionPosition", () => {
    it("place/removeのposition更新", () => {
      mockSection.dialogues[0] = createDialogue([
        { type: "place", position: { row: 0, col: 0 }, color: "black" },
      ]);

      const { updateBoardActionPosition } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      updateBoardActionPosition(0, 0, "position", "row", 7);

      expect(updateDialogue).toHaveBeenCalled();
      const [[, callArgs]] = updateDialogue.mock.calls;
      const action = callArgs.boardActions[0] as PlaceMoveAction;
      expect(action.position.row).toBe(7);
    });

    it("lineのfromPosition更新", () => {
      mockSection.dialogues[0] = createDialogue([
        {
          type: "line",
          fromPosition: { row: 0, col: 0 },
          toPosition: { row: 14, col: 14 },
          action: "draw",
        },
      ]);

      const { updateBoardActionPosition } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      updateBoardActionPosition(0, 0, "fromPosition", "col", 5);

      expect(updateDialogue).toHaveBeenCalled();
      const [[, callArgs]] = updateDialogue.mock.calls;
      const action = callArgs.boardActions[0] as LineAction;
      expect(action.fromPosition.col).toBe(5);
    });

    it("値のクランプ（0-14）- 負の値", () => {
      mockSection.dialogues[0] = createDialogue([
        { type: "place", position: { row: 0, col: 0 }, color: "black" },
      ]);

      const { updateBoardActionPosition } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      updateBoardActionPosition(0, 0, "position", "row", -5);

      const [[, callArgs]] = updateDialogue.mock.calls;
      const action = callArgs.boardActions[0] as PlaceMoveAction;
      expect(action.position.row).toBe(0);
    });

    it("値のクランプ（0-14）- 15以上", () => {
      mockSection.dialogues[0] = createDialogue([
        { type: "place", position: { row: 0, col: 0 }, color: "black" },
      ]);

      const { updateBoardActionPosition } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      updateBoardActionPosition(0, 0, "position", "col", 20);

      const [[, callArgs]] = updateDialogue.mock.calls;
      const action = callArgs.boardActions[0] as PlaceMoveAction;
      expect(action.position.col).toBe(14);
    });
  });

  describe("updateBoardActionColor", () => {
    it("placeアクションの色を更新", () => {
      mockSection.dialogues[0] = createDialogue([
        { type: "place", position: { row: 0, col: 0 }, color: "black" },
      ]);

      const { updateBoardActionColor } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      updateBoardActionColor(0, 0, "white");

      const [[, callArgs]] = updateDialogue.mock.calls;
      const action = callArgs.boardActions[0] as PlaceMoveAction;
      expect(action.color).toBe("white");
    });

    it("place以外のタイプでは何もしない", () => {
      mockSection.dialogues[0] = createDialogue([
        { type: "remove", position: { row: 0, col: 0 } },
      ]);

      const { updateBoardActionColor } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      updateBoardActionColor(0, 0, "white");

      expect(updateDialogue).not.toHaveBeenCalled();
    });
  });

  describe("updateBoardActionHighlight", () => {
    it("placeアクションのhighlightを更新", () => {
      mockSection.dialogues[0] = createDialogue([
        {
          type: "place",
          position: { row: 0, col: 0 },
          color: "black",
          highlight: false,
        },
      ]);

      const { updateBoardActionHighlight } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      updateBoardActionHighlight(0, 0, true);

      const [[, callArgs]] = updateDialogue.mock.calls;
      const action = callArgs.boardActions[0] as PlaceMoveAction;
      expect(action.highlight).toBe(true);
    });
  });

  describe("updateBoardActionBoard", () => {
    it("setBoardアクションのboardを更新", () => {
      mockSection.dialogues[0] = createDialogue([
        { type: "setBoard", board: Array(15).fill("-".repeat(15)) },
      ]);

      const { updateBoardActionBoard } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      const newBoard = Array(15).fill("X".repeat(15));
      updateBoardActionBoard(0, 0, newBoard);

      const [[, callArgs]] = updateDialogue.mock.calls;
      const action = callArgs.boardActions[0] as SetBoardAction;
      expect(action.board[0]).toBe("X".repeat(15));
    });
  });

  describe("Mark関連", () => {
    describe("addBoardActionMarkPosition", () => {
      it("markアクションにposition追加", () => {
        mockSection.dialogues[0] = createDialogue([
          { type: "mark", positions: [], markType: "circle" },
        ]);

        const { addBoardActionMarkPosition } = useBoardActions(
          getCurrentSection,
          updateDialogue,
        );

        addBoardActionMarkPosition(0, 0);

        const [[, callArgs]] = updateDialogue.mock.calls;
        const action = callArgs.boardActions[0] as MarkAction;
        expect(action.positions).toHaveLength(1);
        expect(action.positions[0]).toEqual({
          row: 0,
          col: 0,
        });
      });
    });

    describe("updateBoardActionMarkPosition", () => {
      it("markアクションのposition更新", () => {
        mockSection.dialogues[0] = createDialogue([
          {
            type: "mark",
            positions: [{ row: 0, col: 0 }],
            markType: "circle",
          },
        ]);

        const { updateBoardActionMarkPosition } = useBoardActions(
          getCurrentSection,
          updateDialogue,
        );

        updateBoardActionMarkPosition(0, 0, 0, "row", 7);

        const [[, callArgs]] = updateDialogue.mock.calls;
        const action = callArgs.boardActions[0] as MarkAction;
        expect(action.positions[0].row).toBe(7);
      });

      it("値のクランプ（0-14）", () => {
        mockSection.dialogues[0] = createDialogue([
          {
            type: "mark",
            positions: [{ row: 0, col: 0 }],
            markType: "circle",
          },
        ]);

        const { updateBoardActionMarkPosition } = useBoardActions(
          getCurrentSection,
          updateDialogue,
        );

        updateBoardActionMarkPosition(0, 0, 0, "col", 99);

        const [[, callArgs]] = updateDialogue.mock.calls;
        const action = callArgs.boardActions[0] as MarkAction;
        expect(action.positions[0].col).toBe(14);
      });
    });

    describe("removeBoardActionMarkPosition", () => {
      it("markアクションからposition削除", () => {
        mockSection.dialogues[0] = createDialogue([
          {
            type: "mark",
            positions: [
              { row: 0, col: 0 },
              { row: 1, col: 1 },
            ],
            markType: "circle",
          },
        ]);

        const { removeBoardActionMarkPosition } = useBoardActions(
          getCurrentSection,
          updateDialogue,
        );

        removeBoardActionMarkPosition(0, 0, 0);

        const [[, callArgs]] = updateDialogue.mock.calls;
        const action = callArgs.boardActions[0] as MarkAction;
        expect(action.positions).toHaveLength(1);
        expect(action.positions[0]).toEqual({
          row: 1,
          col: 1,
        });
      });
    });

    describe("updateBoardActionMarkMeta", () => {
      it("markTypeを更新", () => {
        mockSection.dialogues[0] = createDialogue([
          { type: "mark", positions: [], markType: "circle" },
        ]);

        const { updateBoardActionMarkMeta } = useBoardActions(
          getCurrentSection,
          updateDialogue,
        );

        updateBoardActionMarkMeta(0, 0, { markType: "cross" });

        const [[, callArgs]] = updateDialogue.mock.calls;
        const action = callArgs.boardActions[0] as MarkAction;
        expect(action.markType).toBe("cross");
      });

      it("labelを更新", () => {
        mockSection.dialogues[0] = createDialogue([
          { type: "mark", positions: [], markType: "circle" },
        ]);

        const { updateBoardActionMarkMeta } = useBoardActions(
          getCurrentSection,
          updateDialogue,
        );

        updateBoardActionMarkMeta(0, 0, { label: "A" });

        const [[, callArgs]] = updateDialogue.mock.calls;
        const action = callArgs.boardActions[0] as MarkAction;
        expect(action.label).toBe("A");
      });
    });
  });

  describe("updateBoardActionLine", () => {
    it("lineアクションを更新", () => {
      mockSection.dialogues[0] = createDialogue([
        {
          type: "line",
          fromPosition: { row: 0, col: 0 },
          toPosition: { row: 14, col: 14 },
          action: "draw",
        },
      ]);

      const { updateBoardActionLine } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      updateBoardActionLine(0, 0, { action: "remove", style: "dashed" });

      const [[, callArgs]] = updateDialogue.mock.calls;
      const action = callArgs.boardActions[0] as LineAction;
      expect(action.action).toBe("remove");
      expect(action.style).toBe("dashed");
    });
  });

  describe("updateBoardActionType", () => {
    it("タイプを変更するとデフォルト値で初期化", () => {
      mockSection.dialogues[0] = createDialogue([
        { type: "place", position: { row: 7, col: 7 }, color: "white" },
      ]);

      const { updateBoardActionType } = useBoardActions(
        getCurrentSection,
        updateDialogue,
      );

      updateBoardActionType(0, 0, "mark");

      const [[, callArgs]] = updateDialogue.mock.calls;
      const action = callArgs.boardActions[0] as MarkAction;
      expect(action.type).toBe("mark");
      expect(action.positions).toEqual([]);
      expect(action.markType).toBe("circle");
    });
  });
});
