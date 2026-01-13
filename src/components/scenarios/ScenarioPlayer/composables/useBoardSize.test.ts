import { describe, expect, it, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";

import { useBoardSize } from "./useBoardSize";

// @vueuse/coreのuseElementSizeをモック
const mockWidth = ref(500);
const mockHeight = ref(400);

vi.mock("@vueuse/core", () => ({
  useElementSize: vi.fn(() => ({
    width: mockWidth,
    height: mockHeight,
  })),
}));

describe("useBoardSize", () => {
  beforeEach(() => {
    mockWidth.value = 500;
    mockHeight.value = 400;
    // console.warnを抑制
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  describe("boardFrameWidth/boardFrameHeight", () => {
    it("useElementSizeの値を返す", () => {
      const boardFrameRef = ref<HTMLElement | null>(null);
      const { boardFrameWidth, boardFrameHeight } = useBoardSize(boardFrameRef);

      expect(boardFrameWidth.value).toBe(500);
      expect(boardFrameHeight.value).toBe(400);
    });
  });

  describe("boardSize", () => {
    it("高さを基準にボードサイズを計算", () => {
      const boardFrameRef = ref<HTMLElement | null>(null);
      const { boardSize } = useBoardSize(boardFrameRef);

      // 実装では高さ優先で計算
      expect(boardSize.value).toBe(400);
    });

    it("幅と高さが異なる場合も高さを使用", async () => {
      const boardFrameRef = ref<HTMLElement | null>(null);
      const { boardSize } = useBoardSize(boardFrameRef);

      mockWidth.value = 800;
      mockHeight.value = 600;
      await nextTick();

      expect(boardSize.value).toBe(600);
    });

    it("幅と高さが等しい場合、その値を返す", async () => {
      const boardFrameRef = ref<HTMLElement | null>(null);
      const { boardSize } = useBoardSize(boardFrameRef);

      mockWidth.value = 500;
      mockHeight.value = 500;
      await nextTick();

      expect(boardSize.value).toBe(500);
    });
  });

  describe("0次元フォールバック", () => {
    it("高さが0の場合、デフォルト値400を返す", async () => {
      const boardFrameRef = ref<HTMLElement | null>(null);
      const { boardSize } = useBoardSize(boardFrameRef);

      mockWidth.value = 500;
      mockHeight.value = 0;
      await nextTick();

      expect(boardSize.value).toBe(400);
    });

    it("幅が0の場合、デフォルト値400を返す", async () => {
      const boardFrameRef = ref<HTMLElement | null>(null);
      const { boardSize } = useBoardSize(boardFrameRef);

      mockWidth.value = 0;
      mockHeight.value = 500;
      await nextTick();

      expect(boardSize.value).toBe(400);
    });

    it("両方0の場合、デフォルト値400を返す", async () => {
      const boardFrameRef = ref<HTMLElement | null>(null);
      const { boardSize } = useBoardSize(boardFrameRef);

      mockWidth.value = 0;
      mockHeight.value = 0;
      await nextTick();

      expect(boardSize.value).toBe(400);
    });
  });

  describe("リアクティビティ", () => {
    it("サイズ変更に反応する", async () => {
      const boardFrameRef = ref<HTMLElement | null>(null);
      const { boardSize } = useBoardSize(boardFrameRef);

      expect(boardSize.value).toBe(400);

      mockHeight.value = 600;
      await nextTick();

      expect(boardSize.value).toBe(600);
    });
  });
});
