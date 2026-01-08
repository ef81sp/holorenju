import Konva from "konva";
import { nextTick } from "vue";

import type { Mark, Line } from "@/stores/boardStore";
import type { Position } from "@/types/game";

import type { useRenjuBoardLayout } from "./useRenjuBoardLayout";

type LayoutType = ReturnType<typeof useRenjuBoardLayout>;

export function useRenjuBoardAnimation(layout: LayoutType): {
  stoneRefs: Record<string, unknown>;
  markRefs: Record<string, unknown>;
  lineRefs: Record<string, unknown>;
  animateStone: (position: Position) => Promise<void>;
  animateMark: (mark: Mark) => Promise<void>;
  animateLine: (line: Line) => Promise<void>;
  finishAllAnimations: () => void;
} {
  const stoneRefs: Record<string, unknown> = {};
  const markRefs: Record<string, unknown> = {};
  const lineRefs: Record<string, unknown> = {};
  const activeTweens = new Map<string, Konva.Tween>();

  /**
   * 指定座標の石をアニメーション
   * 初期状態（opacity 0.5, scale 0.8）から最終状態（opacity 1, scale 1）へ
   */
  const animateStone = (position: Position): Promise<void> =>
    new Promise((resolve) => {
      nextTick(() => {
        const stoneKey = `${position.row}-${position.col}`;
        const nodeRef = stoneRefs[stoneKey];
        if (!nodeRef) {
          resolve();
          return;
        }

        // @ts-expect-error: Vue template ref methods
        const konvaNode = nodeRef.getNode?.();
        if (!konvaNode) {
          resolve();
          return;
        }

        // 現在のy位置を取得
        const targetY = layout.positionToPixels(position.row, position.col).y;
        const startY = targetY - layout.CELL_SIZE.value * 0.25;

        // 初期状態を設定（configで設定済みだが、y位置のみ変更）
        konvaNode.y(startY);

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
            activeTweens.delete(stoneKey);
            resolve();
          },
        });

        activeTweens.set(stoneKey, tween);
        tween.play();
      });
    });

  /**
   * マークをアニメーション
   * 初期状態（opacity 0, scale 0.6）から最終状態（opacity 1, scale 1）へ
   */
  const animateMark = (mark: Mark): Promise<void> =>
    new Promise((resolve) => {
      nextTick(() => {
        const markKey = mark.id;
        const nodeRef = markRefs[markKey];
        if (!nodeRef) {
          resolve();
          return;
        }

        // @ts-expect-error: Vue template ref methods
        const konvaNode = nodeRef.getNode?.();
        if (!konvaNode) {
          resolve();
          return;
        }

        const tween = new Konva.Tween({
          node: konvaNode,
          duration: 0.25,
          opacity: 1,
          scaleX: 1,
          scaleY: 1,
          easing: Konva.Easings.BackEaseOut,
          onFinish: () => {
            activeTweens.delete(markKey);
            resolve();
          },
        });

        activeTweens.set(markKey, tween);
        tween.play();
      });
    });

  /**
   * ラインをアニメーション
   * 初期状態（opacity 0）から最終状態（opacity 1）へ
   */
  const animateLine = (line: Line): Promise<void> =>
    new Promise((resolve) => {
      nextTick(() => {
        const lineKey = line.id;
        const nodeRef = lineRefs[lineKey];
        if (!nodeRef) {
          resolve();
          return;
        }

        // @ts-expect-error: Vue template ref methods
        const konvaNode = nodeRef.getNode?.();
        if (!konvaNode) {
          resolve();
          return;
        }

        const tween = new Konva.Tween({
          node: konvaNode,
          duration: 0.2,
          opacity: 1,
          easing: Konva.Easings.EaseOut,
          onFinish: () => {
            activeTweens.delete(lineKey);
            resolve();
          },
        });

        activeTweens.set(lineKey, tween);
        tween.play();
      });
    });

  /**
   * 全てのアニメーションを即座に完了
   * 連打時に呼び出され、Tweenを最終状態にジャンプさせる
   */
  const finishAllAnimations = (): void => {
    for (const [, tween] of activeTweens.entries()) {
      tween.finish(); // 最終状態へジャンプ、onFinish実行
    }
    activeTweens.clear();
  };

  return {
    stoneRefs,
    markRefs,
    lineRefs,
    animateStone,
    animateMark,
    animateLine,
    finishAllAnimations,
  };
}
