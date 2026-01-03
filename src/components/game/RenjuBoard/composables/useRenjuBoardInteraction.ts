import { ref } from "vue";

import type { BoardState, PreviewStone, Position } from "@/types/game";

import type { useRenjuBoardLayout } from "./useRenjuBoardLayout";

type LayoutType = ReturnType<typeof useRenjuBoardLayout>;

export function useRenjuBoardInteraction(
  props: {
    disabled: boolean;
    allowOverwrite: boolean;
    boardState: BoardState;
  },
  layout: LayoutType,
  emit: (event: string, ...args: unknown[]) => void,
): {
  previewStone: ReturnType<typeof ref<PreviewStone | null>>;
  hoveredPosition: ReturnType<typeof ref<Position | null>>;
  handleStageClick: (e: {
    target: {
      getStage: () => {
        getPointerPosition: () => { x: number; y: number } | null;
      };
    };
  }) => void;
  handleStageMouseMove: (e: {
    target: {
      getStage: () => {
        getPointerPosition: () => { x: number; y: number } | null;
      };
    };
  }) => void;
  handleStageMouseLeave: () => void;
} {
  // 状態
  const previewStone = ref<PreviewStone | null>(null);
  const hoveredPosition = ref<Position | null>(null);

  // クリックハンドラー
  const handleStageClick = (e: {
    target: {
      getStage: () => {
        getPointerPosition: () => { x: number; y: number } | null;
      };
    };
  }): void => {
    if (props.disabled) {
      return;
    }

    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();

    if (!pointerPosition) {
      return;
    }

    const position = layout.pixelsToPosition(
      pointerPosition.x,
      pointerPosition.y,
    );

    if (!position) {
      return;
    }

    // すでに石が置かれている場所はクリック不可
    if (
      !props.allowOverwrite &&
      props.boardState[position.row]?.[position.col]
    ) {
      return;
    }

    if (props.allowOverwrite) {
      emit("placeStone", position);
      return;
    }

    // 仮指定中の石と同じ位置をクリックした場合は確定
    if (
      previewStone.value &&
      previewStone.value.position.row === position.row &&
      previewStone.value.position.col === position.col
    ) {
      emit("placeStone", position);
      previewStone.value = null;
    } else {
      // 新しい位置を仮指定
      previewStone.value = {
        color: "black",
        position,
      };
    }
  };

  // マウスムーブハンドラー
  const handleStageMouseMove = (e: {
    target: {
      getStage: () => {
        getPointerPosition: () => { x: number; y: number } | null;
      };
    };
  }): void => {
    if (props.disabled) {
      return;
    }

    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();

    if (!pointerPosition) {
      hoveredPosition.value = null;
      return;
    }

    const position = layout.pixelsToPosition(
      pointerPosition.x,
      pointerPosition.y,
    );

    if (
      position &&
      (props.allowOverwrite || !props.boardState[position.row]?.[position.col])
    ) {
      hoveredPosition.value = position;
      emit("hoverCell", position);
    } else {
      hoveredPosition.value = null;
      emit("hoverCell", null);
    }
  };

  // マウスリーブハンドラー
  const handleStageMouseLeave = (): void => {
    hoveredPosition.value = null;
    emit("hoverCell", null);
  };

  return {
    previewStone,
    hoveredPosition,
    handleStageClick,
    handleStageMouseMove,
    handleStageMouseLeave,
  };
}
