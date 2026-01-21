import { describe, expect, it, vi, beforeEach } from "vitest";

import type { BoardState, Position } from "@/types/game";

import type { useRenjuBoardLayout } from "./useRenjuBoardLayout";

import { useRenjuBoardInteraction } from "./useRenjuBoardInteraction";

type LayoutType = ReturnType<typeof useRenjuBoardLayout>;
type EmitType = (event: string, ...args: unknown[]) => void;

interface MockKonvaEvent {
  target: {
    getStage: () => {
      getPointerPosition: () => { x: number; y: number } | null;
    };
  };
}

describe("useRenjuBoardInteraction", () => {
  // モックレイアウト
  const createMockLayout = (): {
    pixelsToPosition: ReturnType<
      typeof vi.fn<(x: number, y: number) => Position | null>
    >;
  } => ({
    pixelsToPosition: vi.fn((x: number, y: number): Position | null => {
      const row = Math.floor(y / 32);
      const col = Math.floor(x / 32);
      if (row < 0 || row >= 15 || col < 0 || col >= 15) {
        return null;
      }
      return { row, col };
    }),
  });

  // モックKonvaイベント
  const createMockKonvaEvent = (x: number, y: number): MockKonvaEvent => ({
    target: {
      getStage: () => ({
        getPointerPosition: () => ({ x, y }),
      }),
    },
  });

  // 空のボード状態を作成
  const createEmptyBoard = (): BoardState =>
    Array(15)
      .fill(null)
      .map(() => Array(15).fill(null));

  let mockEmit: EmitType = vi.fn();
  let mockLayout: ReturnType<typeof createMockLayout> = createMockLayout();

  beforeEach(() => {
    mockEmit = vi.fn();
    mockLayout = createMockLayout();
  });

  describe("handleStageClick", () => {
    it("空セルをクリックすると仮指定状態になる", () => {
      const props = {
        disabled: false,
        allowOverwrite: false,
        boardState: createEmptyBoard(),
        playerColor: "black" as const,
      };

      const { handleStageClick, previewStone } = useRenjuBoardInteraction(
        props,
        mockLayout as unknown as LayoutType,
        mockEmit,
      );

      // (64, 64) -> row: 2, col: 2
      handleStageClick(createMockKonvaEvent(64, 64));

      expect(previewStone.value).toEqual({
        color: "black",
        position: { row: 2, col: 2 },
      });
      expect(mockEmit).not.toHaveBeenCalledWith(
        "placeStone",
        expect.anything(),
      );
    });

    it("同じ位置を2回クリックするとemitが呼ばれる", () => {
      const props = {
        disabled: false,
        allowOverwrite: false,
        boardState: createEmptyBoard(),
        playerColor: "black" as const,
      };

      const { handleStageClick, previewStone } = useRenjuBoardInteraction(
        props,
        mockLayout as unknown as LayoutType,
        mockEmit,
      );

      // 1回目: 仮指定
      handleStageClick(createMockKonvaEvent(64, 64));
      expect(previewStone.value).not.toBeNull();

      // 2回目: 確定
      handleStageClick(createMockKonvaEvent(64, 64));
      expect(mockEmit).toHaveBeenCalledWith("placeStone", { row: 2, col: 2 });
      expect(previewStone.value).toBeNull();
    });

    it("占有セルをクリックするとemitは呼ばれない", () => {
      const boardState = createEmptyBoard();
      boardState[2][2] = "black";

      const props = {
        disabled: false,
        allowOverwrite: false,
        boardState,
        playerColor: "black" as const,
      };

      const { handleStageClick } = useRenjuBoardInteraction(
        props,
        mockLayout as unknown as LayoutType,
        mockEmit,
      );

      handleStageClick(createMockKonvaEvent(64, 64));

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("allowOverwrite=trueなら占有セルでもemit", () => {
      const boardState = createEmptyBoard();
      boardState[2][2] = "black";

      const props = {
        disabled: false,
        allowOverwrite: true,
        boardState,
        playerColor: "black" as const,
      };

      const { handleStageClick } = useRenjuBoardInteraction(
        props,
        mockLayout as unknown as LayoutType,
        mockEmit,
      );

      handleStageClick(createMockKonvaEvent(64, 64));

      expect(mockEmit).toHaveBeenCalledWith("placeStone", { row: 2, col: 2 });
    });

    it("disabledの場合は何もしない", () => {
      const props = {
        disabled: true,
        allowOverwrite: false,
        boardState: createEmptyBoard(),
        playerColor: "black" as const,
      };

      const { handleStageClick, previewStone } = useRenjuBoardInteraction(
        props,
        mockLayout as unknown as LayoutType,
        mockEmit,
      );

      handleStageClick(createMockKonvaEvent(64, 64));

      expect(previewStone.value).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("pointerPositionがnullの場合は何もしない", () => {
      const props = {
        disabled: false,
        allowOverwrite: false,
        boardState: createEmptyBoard(),
        playerColor: "black" as const,
      };

      const { handleStageClick } = useRenjuBoardInteraction(
        props,
        mockLayout as unknown as LayoutType,
        mockEmit,
      );

      handleStageClick({
        target: {
          getStage: () => ({
            getPointerPosition: () => null,
          }),
        },
      });

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe("handleStageMouseMove", () => {
    it("hoveredPositionが更新される", () => {
      const props = {
        disabled: false,
        allowOverwrite: false,
        boardState: createEmptyBoard(),
        playerColor: "black" as const,
      };

      const { handleStageMouseMove, hoveredPosition } =
        useRenjuBoardInteraction(
          props,
          mockLayout as unknown as LayoutType,
          mockEmit,
        );

      handleStageMouseMove(createMockKonvaEvent(96, 128));

      expect(hoveredPosition.value).toEqual({ row: 4, col: 3 });
      expect(mockEmit).toHaveBeenCalledWith("hoverCell", { row: 4, col: 3 });
    });

    it("占有セルではhoveredPositionがnullになる", () => {
      const boardState = createEmptyBoard();
      boardState[4][3] = "white";

      const props = {
        disabled: false,
        allowOverwrite: false,
        boardState,
        playerColor: "black" as const,
      };

      const { handleStageMouseMove, hoveredPosition } =
        useRenjuBoardInteraction(
          props,
          mockLayout as unknown as LayoutType,
          mockEmit,
        );

      handleStageMouseMove(createMockKonvaEvent(96, 128));

      expect(hoveredPosition.value).toBeNull();
      expect(mockEmit).toHaveBeenCalledWith("hoverCell", null);
    });

    it("allowOverwrite=trueなら占有セルでもhoveredPositionが更新される", () => {
      const boardState = createEmptyBoard();
      boardState[4][3] = "white";

      const props = {
        disabled: false,
        allowOverwrite: true,
        boardState,
        playerColor: "black" as const,
      };

      const { handleStageMouseMove, hoveredPosition } =
        useRenjuBoardInteraction(
          props,
          mockLayout as unknown as LayoutType,
          mockEmit,
        );

      handleStageMouseMove(createMockKonvaEvent(96, 128));

      expect(hoveredPosition.value).toEqual({ row: 4, col: 3 });
    });

    it("disabledの場合は何もしない", () => {
      const props = {
        disabled: true,
        allowOverwrite: false,
        boardState: createEmptyBoard(),
        playerColor: "black" as const,
      };

      const { handleStageMouseMove, hoveredPosition } =
        useRenjuBoardInteraction(
          props,
          mockLayout as unknown as LayoutType,
          mockEmit,
        );

      handleStageMouseMove(createMockKonvaEvent(96, 128));

      expect(hoveredPosition.value).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("pointerPositionがnullの場合はhoveredPositionがnullになる", () => {
      const props = {
        disabled: false,
        allowOverwrite: false,
        boardState: createEmptyBoard(),
        playerColor: "black" as const,
      };

      const { handleStageMouseMove, hoveredPosition } =
        useRenjuBoardInteraction(
          props,
          mockLayout as unknown as LayoutType,
          mockEmit,
        );

      handleStageMouseMove({
        target: {
          getStage: () => ({
            getPointerPosition: () => null,
          }),
        },
      });

      expect(hoveredPosition.value).toBeNull();
    });
  });

  describe("handleStageMouseLeave", () => {
    it("hoveredPositionがnullになる", () => {
      const props = {
        disabled: false,
        allowOverwrite: false,
        boardState: createEmptyBoard(),
        playerColor: "black" as const,
      };

      const { handleStageMouseMove, handleStageMouseLeave, hoveredPosition } =
        useRenjuBoardInteraction(
          props,
          mockLayout as unknown as LayoutType,
          mockEmit,
        );

      // まずホバー状態にする
      handleStageMouseMove(createMockKonvaEvent(64, 64));
      expect(hoveredPosition.value).not.toBeNull();

      // リーブ
      handleStageMouseLeave();

      expect(hoveredPosition.value).toBeNull();
      expect(mockEmit).toHaveBeenCalledWith("hoverCell", null);
    });
  });

  describe("座標変換", () => {
    it("ピクセル座標がボード座標に変換される", () => {
      const props = {
        disabled: false,
        allowOverwrite: false,
        boardState: createEmptyBoard(),
        playerColor: "black" as const,
      };

      const { handleStageMouseMove, hoveredPosition } =
        useRenjuBoardInteraction(
          props,
          mockLayout as unknown as LayoutType,
          mockEmit,
        );

      // (160, 224) -> row: 7, col: 5
      handleStageMouseMove(createMockKonvaEvent(160, 224));

      expect(mockLayout.pixelsToPosition).toHaveBeenCalledWith(160, 224);
      expect(hoveredPosition.value).toEqual({ row: 7, col: 5 });
    });

    it("範囲外座標はnullになる", () => {
      mockLayout.pixelsToPosition.mockReturnValue(null);

      const props = {
        disabled: false,
        allowOverwrite: false,
        boardState: createEmptyBoard(),
        playerColor: "black" as const,
      };

      const { handleStageMouseMove, hoveredPosition } =
        useRenjuBoardInteraction(
          props,
          mockLayout as unknown as LayoutType,
          mockEmit,
        );

      handleStageMouseMove(createMockKonvaEvent(-100, -100));

      expect(hoveredPosition.value).toBeNull();
    });
  });

  describe("previewStone状態管理", () => {
    it("異なる位置をクリックすると仮指定が更新される", () => {
      const props = {
        disabled: false,
        allowOverwrite: false,
        boardState: createEmptyBoard(),
        playerColor: "black" as const,
      };

      const { handleStageClick, previewStone } = useRenjuBoardInteraction(
        props,
        mockLayout as unknown as LayoutType,
        mockEmit,
      );

      // 1つ目の位置をクリック
      handleStageClick(createMockKonvaEvent(64, 64));
      expect(previewStone.value?.position).toEqual({ row: 2, col: 2 });

      // 異なる位置をクリック
      handleStageClick(createMockKonvaEvent(128, 128));
      expect(previewStone.value?.position).toEqual({ row: 4, col: 4 });
    });
  });
});
