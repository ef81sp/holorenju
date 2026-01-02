import { computed, ref } from "vue";
import { useElementSize } from "@vueuse/core";

/**
 * ボードフレームのサイズを計測し、ボードサイズを計算するComposable
 *
 * useElementSizeを使用して参照要素のサイズをリアルタイムに監視し、
 * 利用可能な幅と高さから最適なボードサイズを計算します。
 * 初期化時に値が0の場合のフォールバック処理を含みます。
 */
export const useBoardSize = (boardFrameRef: ReturnType<typeof ref>) => {
  const { width: boardFrameWidth, height: boardFrameHeight } = useElementSize(
    boardFrameRef,
    {
      width: 0,
      height: 0,
    },
  );

  // 計算されたボードサイズ
  const boardSize = computed(() => {
    const availableWidth = boardFrameWidth.value;
    const availableHeight = boardFrameHeight.value;

    // 初期値が0の場合は計算しない（最小サイズを返す）
    if (availableWidth === 0 || availableHeight === 0) {
      console.warn("[useBoardSize] width or height is 0");
      return 400; // 最小デフォルトサイズ
    }

    const calculatedSize = Math.min(availableWidth, availableHeight);

    console.warn("[useBoardSize] computed:", {
      availableWidth,
      availableHeight,
      calculatedSize,
    });

    return calculatedSize;
  });

  return {
    boardFrameWidth,
    boardFrameHeight,
    boardSize,
  };
};
