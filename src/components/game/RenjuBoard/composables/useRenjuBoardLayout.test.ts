import { describe, expect, it } from "vitest";
import { computed } from "vue";

import { useRenjuBoardLayout } from "./useRenjuBoardLayout";

describe("useRenjuBoardLayout", () => {
  // 標準的な480pxのステージサイズでテスト
  const stageSize = computed(() => 480);
  const layout = useRenjuBoardLayout(stageSize);

  describe("constants", () => {
    it("has BOARD_SIZE of 15", () => {
      expect(layout.BOARD_SIZE).toBe(15);
    });

    it("computes CELL_SIZE as stageSize / 16", () => {
      expect(layout.CELL_SIZE.value).toBe(30); // 480 / 16
    });

    it("computes PADDING for centered board", () => {
      // PADDING = (width - (15-1) * cellSize) / 2
      // = (480 - 14 * 30) / 2 = (480 - 420) / 2 = 30
      expect(layout.PADDING.value).toBe(30);
    });

    it("computes STONE_RADIUS based on CELL_SIZE", () => {
      // STONE_RADIUS = CELL_SIZE * 0.45 = 30 * 0.45 = 13.5
      expect(layout.STONE_RADIUS.value).toBe(13.5);
    });
  });

  describe("positionToPixels", () => {
    it("converts (0, 0) to padding offset", () => {
      const { x, y } = layout.positionToPixels(0, 0);
      expect(x).toBe(30); // PADDING
      expect(y).toBe(30); // PADDING
    });

    it("converts center position (7, 7) correctly", () => {
      const { x, y } = layout.positionToPixels(7, 7);
      // x = PADDING + col * CELL_SIZE = 30 + 7 * 30 = 240
      // y = PADDING + row * CELL_SIZE = 30 + 7 * 30 = 240
      expect(x).toBe(240);
      expect(y).toBe(240);
    });

    it("converts corner (14, 14) correctly", () => {
      const { x, y } = layout.positionToPixels(14, 14);
      // x = 30 + 14 * 30 = 450
      // y = 30 + 14 * 30 = 450
      expect(x).toBe(450);
      expect(y).toBe(450);
    });
  });

  describe("pixelsToPosition", () => {
    it("converts exact pixel position to grid position", () => {
      const pos = layout.pixelsToPosition(240, 240);
      expect(pos).toEqual({ row: 7, col: 7 });
    });

    it("rounds to nearest position", () => {
      // 240 is center of (7,7), so 250 (10px off) should still round to (7,7)
      const pos = layout.pixelsToPosition(250, 250);
      expect(pos).toEqual({ row: 7, col: 7 });
    });

    it("returns null for positions outside the board (negative)", () => {
      const pos = layout.pixelsToPosition(0, 0);
      expect(pos).toBeNull();
    });

    it("returns null for positions outside the board (too large)", () => {
      const pos = layout.pixelsToPosition(480, 480);
      expect(pos).toBeNull();
    });

    it("converts corner position (0, 0) correctly", () => {
      const pos = layout.pixelsToPosition(30, 30);
      expect(pos).toEqual({ row: 0, col: 0 });
    });

    it("converts corner position (14, 14) correctly", () => {
      const pos = layout.pixelsToPosition(450, 450);
      expect(pos).toEqual({ row: 14, col: 14 });
    });
  });

  describe("round-trip conversion", () => {
    it("positionToPixels and pixelsToPosition are inverse operations", () => {
      for (let row = 0; row < 15; row++) {
        for (let col = 0; col < 15; col++) {
          const { x, y } = layout.positionToPixels(row, col);
          const pos = layout.pixelsToPosition(x, y);
          expect(pos).toEqual({ row, col });
        }
      }
    });
  });

  describe("reactive updates", () => {
    it("updates computed values when stageSize changes", () => {
      const dynamicSize = computed(() => 320);
      const dynamicLayout = useRenjuBoardLayout(dynamicSize);

      // 320 / 16 = 20
      expect(dynamicLayout.CELL_SIZE.value).toBe(20);
      // (320 - 14 * 20) / 2 = (320 - 280) / 2 = 20
      expect(dynamicLayout.PADDING.value).toBe(20);
    });
  });
});
