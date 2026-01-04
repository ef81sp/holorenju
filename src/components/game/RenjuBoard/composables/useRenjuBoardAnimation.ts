import Konva from "konva";
import { nextTick } from "vue";

import type { Position } from "@/types/game";

import type { useRenjuBoardLayout } from "./useRenjuBoardLayout";

type LayoutType = ReturnType<typeof useRenjuBoardLayout>;

export function useRenjuBoardAnimation(layout: LayoutType): {
  stoneRefs: Record<string, unknown>;
  markRefs: Record<string, unknown>;
  lineRefs: Record<string, unknown>;
  animateLastPlacedStone: (
    stoneKey: string,
    position?: Position,
  ) => Promise<void>;
  animateLastAddedMarks: (markKeys: string[]) => Promise<void>;
  animateLastAddedLines: (lineKeys: string[]) => Promise<void>;
} {
  const stoneRefs: Record<string, unknown> = {};
  const markRefs: Record<string, unknown> = {};
  const lineRefs: Record<string, unknown> = {};

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
    markRefs,
    lineRefs,
    animateLastPlacedStone,
    animateLastAddedMarks,
    animateLastAddedLines,
  };

  // 最後に追加されたMark のアニメーション
  // FIXME: アニメーションされたりされなかったりする。再計画が必要。
  function animateLastAddedMarks(_markKeysToAnimate: string[]): Promise<void> {
    return new Promise(() => {});
    // return new Promise((resolve) => {
    //   nextTick(() => {
    //     if (markKeysToAnimate.length === 0) {
    //       resolve();
    //       return;
    //     }

    //     let completedCount = 0;

    //     markKeysToAnimate.forEach((key) => {
    //       const nodeRef = markRefs[key];
    //       if (!nodeRef) {
    //         completedCount++;
    //         return;
    //       }

    //       // @ts-expect-error: Vue template ref methods
    //       const konvaNode = nodeRef.getNode?.();
    //       if (!konvaNode || !konvaNode.getParent()) {
    //         completedCount++;
    //         return;
    //       }

    //       konvaNode.opacity(0);
    //       konvaNode.scaleX(0.6);
    //       konvaNode.scaleY(0.6);

    //       const tween = new Konva.Tween({
    //         node: konvaNode,
    //         duration: 0.2,
    //         opacity: 1,
    //         scaleX: 1,
    //         scaleY: 1,
    //         easing: Konva.Easings.EaseOut,
    //         onFinish: () => {
    //           completedCount++;
    //           if (completedCount === markKeysToAnimate.length) {
    //             resolve();
    //           }
    //         },
    //       });

    //       tween.play();
    //     });
    //   });
    // });
  }

  // 最後に追加されたLine のアニメーション
  // FIXME: アニメーションされたりされなかったりする。再計画が必要。
  function animateLastAddedLines(_lineKeysToAnimate: string[]): Promise<void> {
    return new Promise(() => {});
    // return new Promise((resolve) => {
    //   nextTick(() => {
    //     if (lineKeysToAnimate.length === 0) {
    //       resolve();
    //       return;
    //     }

    //     let completedCount = 0;

    //     lineKeysToAnimate.forEach((key) => {
    //       const nodeRef = lineRefs[key];
    //       if (!nodeRef) {
    //         completedCount++;
    //         return;
    //       }

    //       // @ts-expect-error: Vue template ref methods
    //       const konvaNode = nodeRef.getNode?.();
    //       if (!konvaNode || !konvaNode.getParent()) {
    //         completedCount++;
    //         return;
    //       }

    //       konvaNode.opacity(0);
    //       konvaNode.scaleX(0.6);
    //       konvaNode.scaleY(0.6);

    //       const tween = new Konva.Tween({
    //         node: konvaNode,
    //         duration: 0.2,
    //         opacity: 1,
    //         scaleX: 1,
    //         scaleY: 1,
    //         easing: Konva.Easings.EaseOut,
    //         onFinish: () => {
    //           completedCount++;
    //           if (completedCount === lineKeysToAnimate.length) {
    //             resolve();
    //           }
    //         },
    //       });

    //       tween.play();
    //     });
    //   });
    // });
  }
}
