import Konva from "konva";
import { nextTick } from "vue";

import type { Position } from "@/types/game";

import type { useRenjuBoardLayout } from "./useRenjuBoardLayout";

type LayoutType = ReturnType<typeof useRenjuBoardLayout>;

export function useRenjuBoardAnimation(layout: LayoutType): {
  stoneRefs: Record<string, unknown>;
  animateLastPlacedStone: (
    stoneKey: string,
    position?: Position,
  ) => Promise<void>;
} {
  const stoneRefs: Record<string, unknown> = {};

  const animateLastPlacedStone = (
    stoneKey: string,
    position?: Position,
  ): Promise<void> =>
    new Promise((resolve) => {
      nextTick(() => {
        const nodeRef = stoneRefs[stoneKey];
        if (!nodeRef) {
          resolve();
          return;
        }

        // @ts-expect-error: Vue template ref methods
        const konvaNode = nodeRef.getNode?.();
        if (!konvaNode || !position) {
          resolve();
          return;
        }

        // 現在のy位置を取得
        const targetY = layout.positionToPixels(position.row, position.col).y;
        const startY = targetY - layout.CELL_SIZE.value * 0.25;

        // 初期状態を設定
        konvaNode.y(startY);
        konvaNode.opacity(0.5);
        konvaNode.scaleX(0.8);
        konvaNode.scaleY(0.8);

        // アニメーション実行
        const tween = new Konva.Tween({
          node: konvaNode,
          duration: 0.2,
          y: targetY,
          opacity: 1,
          scaleX: 1,
          scaleY: 1,
          easing: Konva.Easings.EaseOut,
          onFinish: () => {
            resolve();
          },
        });

        tween.play();
      });
    });

  return {
    stoneRefs,
    animateLastPlacedStone,
  };
}
