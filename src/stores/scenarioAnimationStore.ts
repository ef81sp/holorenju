/**
 * シナリオアニメーション管理ストア
 *
 * boardStoreから分離されたアニメーション制御を担当。
 * コールバック設定、アニメーション実行、キャンセル処理を管理する。
 */

import { defineStore } from "pinia";
import { ref } from "vue";

import type { Position } from "@/types/game";

import type { Stone, Mark, Line } from "./boardStore";

// コールバック型定義
type OnStoneAnimateCallback = (position: Position) => Promise<void>;
type OnMarkAnimateCallback = (mark: Mark) => Promise<void>;
type OnLineAnimateCallback = (line: Line) => Promise<void>;
type OnAnimationCancelCallback = () => void;

export const useScenarioAnimationStore = defineStore(
  "scenarioAnimation",
  () => {
    // アニメーション中の要素ID
    const animatingIds = ref<Set<string>>(new Set());

    // コールバック
    let onStoneAnimateCallback: OnStoneAnimateCallback | null = null;
    let onMarkAnimateCallback: OnMarkAnimateCallback | null = null;
    let onLineAnimateCallback: OnLineAnimateCallback | null = null;
    let onAnimationCancelCallback: OnAnimationCancelCallback | null = null;

    // レースコンディション対策のID管理
    let currentOperationId: number | null = null;
    let operationIdCounter = 0;

    /**
     * 要素がアニメーション中かどうか
     */
    function isAnimating(id: string): boolean {
      return animatingIds.value.has(id);
    }

    /**
     * アニメーション対象のIDを先行登録（描画前に呼び出す）
     * 石データ追加前にanimatingIdsに登録することで、
     * Vue描画時に半透明で表示されるようにする
     */
    function prepareForAnimation(ids: string[]): void {
      for (const id of ids) {
        animatingIds.value.add(id);
      }
    }

    /**
     * コールバック設定
     */
    function setOnStoneAnimateCallback(
      callback: OnStoneAnimateCallback | null,
    ): void {
      onStoneAnimateCallback = callback;
    }

    function setOnMarkAnimateCallback(
      callback: OnMarkAnimateCallback | null,
    ): void {
      onMarkAnimateCallback = callback;
    }

    function setOnLineAnimateCallback(
      callback: OnLineAnimateCallback | null,
    ): void {
      onLineAnimateCallback = callback;
    }

    function setOnAnimationCancelCallback(
      callback: OnAnimationCancelCallback | null,
    ): void {
      onAnimationCancelCallback = callback;
    }

    /**
     * 石のアニメーションを実行
     */
    async function animateStones(
      stones: Stone[],
      options?: { animate?: boolean },
    ): Promise<void> {
      // animate: falseの場合は先行登録されたIDをクリアして即終了
      if (options?.animate === false) {
        for (const stone of stones) {
          animatingIds.value.delete(stone.id);
        }
        return;
      }

      // コールバック未設定時も先行登録されたIDをクリアして即終了
      if (!onStoneAnimateCallback) {
        for (const stone of stones) {
          animatingIds.value.delete(stone.id);
        }
        return;
      }

      const callId = ++operationIdCounter;
      currentOperationId = callId;

      for (const stone of stones) {
        // 自分の呼び出しがキャンセルされたか確認
        if (currentOperationId !== callId) {
          return;
        }

        // ID登録は prepareForAnimation で済んでいるはず
        // 念のためここでも追加（直接animateStonesが呼ばれた場合用）
        animatingIds.value.add(stone.id);

        // oxlint-disable-next-line no-await-in-loop -- 順次アニメーション実行のため意図的
        await onStoneAnimateCallback(stone.position);

        animatingIds.value.delete(stone.id);

        // await後も再チェック（アニメーション中にキャンセルされた可能性）
        if (currentOperationId !== callId) {
          return;
        }
      }
    }

    /**
     * マークのアニメーションを実行
     */
    async function animateMarks(
      marks: Mark[],
      options?: { animate?: boolean },
    ): Promise<void> {
      // animate: falseの場合は先行登録されたIDをクリアして即終了
      if (options?.animate === false) {
        for (const mark of marks) {
          animatingIds.value.delete(mark.id);
        }
        return;
      }

      // コールバック未設定時も先行登録されたIDをクリアして即終了
      if (!onMarkAnimateCallback) {
        for (const mark of marks) {
          animatingIds.value.delete(mark.id);
        }
        return;
      }

      const callId = ++operationIdCounter;
      currentOperationId = callId;

      for (const mark of marks) {
        if (currentOperationId !== callId) {
          return;
        }

        // ID登録は prepareForAnimation で済んでいるはず
        // 念のためここでも追加（直接animateMarksが呼ばれた場合用）
        animatingIds.value.add(mark.id);

        // oxlint-disable-next-line no-await-in-loop -- 順次アニメーション実行のため意図的
        await onMarkAnimateCallback(mark);

        animatingIds.value.delete(mark.id);

        if (currentOperationId !== callId) {
          return;
        }
      }
    }

    /**
     * ラインのアニメーションを実行
     */
    async function animateLines(
      lines: Line[],
      options?: { animate?: boolean },
    ): Promise<void> {
      // animate: falseの場合は先行登録されたIDをクリアして即終了
      if (options?.animate === false) {
        for (const line of lines) {
          animatingIds.value.delete(line.id);
        }
        return;
      }

      // コールバック未設定時も先行登録されたIDをクリアして即終了
      if (!onLineAnimateCallback) {
        for (const line of lines) {
          animatingIds.value.delete(line.id);
        }
        return;
      }

      const callId = ++operationIdCounter;
      currentOperationId = callId;

      for (const line of lines) {
        if (currentOperationId !== callId) {
          return;
        }

        // ID登録は prepareForAnimation で済んでいるはず
        // 念のためここでも追加（直接animateLinesが呼ばれた場合用）
        animatingIds.value.add(line.id);

        // oxlint-disable-next-line no-await-in-loop -- 順次アニメーション実行のため意図的
        await onLineAnimateCallback(line);

        animatingIds.value.delete(line.id);

        if (currentOperationId !== callId) {
          return;
        }
      }
    }

    /**
     * 進行中のアニメーションをキャンセル
     * 連打時に呼び出され、全てのTweenを即座に完了させる
     */
    function cancelOngoingAnimations(): void {
      // 現在の呼び出しIDを無効化
      currentOperationId = null;

      // 進行中のTweenを即座に完了
      if (onAnimationCancelCallback) {
        onAnimationCancelCallback();
      }

      // animatingIdsをクリア
      animatingIds.value.clear();
    }

    /**
     * 全てリセット（テスト用）
     */
    function $reset(): void {
      animatingIds.value.clear();
      currentOperationId = null;
      operationIdCounter = 0;
      onStoneAnimateCallback = null;
      onMarkAnimateCallback = null;
      onLineAnimateCallback = null;
      onAnimationCancelCallback = null;
    }

    return {
      // State
      animatingIds,
      // Getters
      isAnimating,
      // Callback setters
      setOnStoneAnimateCallback,
      setOnMarkAnimateCallback,
      setOnLineAnimateCallback,
      setOnAnimationCancelCallback,
      // Actions
      prepareForAnimation,
      animateStones,
      animateMarks,
      animateLines,
      cancelOngoingAnimations,
      $reset,
    };
  },
);
