import { ref, type Ref, type ComputedRef } from "vue";

import type { Position } from "@/types/game";

/**
 * キーボード操作全般を管理するComposable
 *
 * W/A/S/Dキーでカーソル移動、Space/Enterキーで石の配置をトリガーします。
 * 左右キーでセリフナビゲーション（デモセクション時のみ）。
 * リスナーの登録・削除、カーソル位置の管理を行います。
 */
export const useKeyboardNavigation = (
  onPlaceStone: () => void,
  onDialogueNavigate?: (direction: "next" | "previous") => void,
  isDisabled?: Ref<boolean> | ComputedRef<boolean>,
  onCursorMove?: () => void,
): {
  cursorPosition: Ref<Position>;
  isCursorActivated: Ref<boolean>;
  handleKeyDown: (event: KeyboardEvent) => void;
  moveCursor: (direction: "up" | "down" | "left" | "right") => void;
  placeStoneAtCursor: () => void;
  attachKeyListener: (element: HTMLElement) => void;
  detachKeyListener: () => void;
  resetCursorActivation: () => void;
} => {
  const cursorPosition = ref<Position>({ row: 7, col: 7 });
  const isCursorActivated = ref(false);

  /**
   * キーボードイベントハンドラー
   */
  const handleKeyDown = (event: KeyboardEvent): void => {
    const { key } = event;
    const isDisabledValue = isDisabled && isDisabled.value;

    switch (key.toLowerCase()) {
      case "w":
      case "s":
      case "a":
      case "d":
        // カーソル移動キーは disabled 時は無効
        if (!isDisabledValue) {
          event.preventDefault();
          if (key.toLowerCase() === "w") {
            moveCursor("up");
          } else if (key.toLowerCase() === "s") {
            moveCursor("down");
          } else if (key.toLowerCase() === "a") {
            moveCursor("left");
          } else if (key.toLowerCase() === "d") {
            moveCursor("right");
          }
        }
        break;
      case " ":
      case "enter":
        // 石配置キーは disabled 時は無効
        if (!isDisabledValue) {
          event.preventDefault();
          placeStoneAtCursor();
        }
        break;
      case "arrowleft":
      case "arrowright":
        // 矢印キーでの会話送りは常に有効
        event.preventDefault();
        event.stopPropagation(); // window リスナーとの二重発火防止
        if (onDialogueNavigate) {
          onDialogueNavigate(
            key.toLowerCase() === "arrowleft" ? "previous" : "next",
          );
        }
        break;
      default:
        break;
    }
  };

  /**
   * カーソルを指定方向に移動
   */
  const moveCursor = (direction: "up" | "down" | "left" | "right"): void => {
    isCursorActivated.value = true;
    switch (direction) {
      case "up":
        cursorPosition.value.row = Math.max(0, cursorPosition.value.row - 1);
        break;
      case "down":
        cursorPosition.value.row = Math.min(14, cursorPosition.value.row + 1);
        break;
      case "left":
        cursorPosition.value.col = Math.max(0, cursorPosition.value.col - 1);
        break;
      case "right":
        cursorPosition.value.col = Math.min(14, cursorPosition.value.col + 1);
        break;
      default:
        break;
    }
    onCursorMove?.();
  };

  /**
   * 現在のカーソル位置に石を配置
   */
  const placeStoneAtCursor = (): void => {
    onPlaceStone();
  };

  let targetElement: HTMLElement | null = null;

  /**
   * キーボードリスナーを指定要素に登録
   */
  const attachKeyListener = (element: HTMLElement): void => {
    targetElement = element;
    element.addEventListener("keydown", handleKeyDown as EventListener);
  };

  /**
   * キーボードリスナーを要素から削除
   */
  const detachKeyListener = (): void => {
    if (targetElement) {
      targetElement.removeEventListener(
        "keydown",
        handleKeyDown as EventListener,
      );
      targetElement = null;
    }
  };

  /**
   * カーソルアクティベーションをリセット
   */
  const resetCursorActivation = (): void => {
    isCursorActivated.value = false;
  };

  return {
    cursorPosition,
    isCursorActivated,
    handleKeyDown,
    moveCursor,
    placeStoneAtCursor,
    attachKeyListener,
    detachKeyListener,
    resetCursorActivation,
  };
};
