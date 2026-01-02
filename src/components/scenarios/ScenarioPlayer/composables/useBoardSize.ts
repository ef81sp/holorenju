import type { Ref } from "vue";

import { useElementSize } from "@vueuse/core";
import { computed } from "vue";

/**
 * ボードフレームのサイズを計測し、ボードサイズを計算するComposable
 *
 * useElementSizeを使用して参照要素のサイズをリアルタイムに監視し、
 * 利用可能な幅と高さから最適なボードサイズを計算します。
 * 初期化時に値が0の場合のフォールバック処理を含みます。
 */
export const useBoardSize = (boardFrameRef: Ref<HTMLElement | null>) => {
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

    // 高さ優先で計算（グリッド行の7frに合わせる）
    const calculatedSize = availableHeight;

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
