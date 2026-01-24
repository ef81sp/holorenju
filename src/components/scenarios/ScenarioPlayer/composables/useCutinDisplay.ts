import { ref, onUnmounted, type Ref } from "vue";

import type { CutinType } from "@/components/common/CutinOverlay.vue";

import { usePreferencesStore } from "@/stores/preferencesStore";

/**
 * カットイン表示を管理するComposable
 *
 * Popover APIを使用してフルスクリーンカットインを表示します。
 * 自動消滅タイマーと任意キー押下でのスキップ機能を提供します。
 */
export const useCutinDisplay = (
  cutinRef: Ref<{ showPopover: () => void; hidePopover: () => void } | null>,
): {
  isCutinVisible: Ref<boolean>;
  showCutin: (type: CutinType) => void;
  hideCutin: () => void;
} => {
  const preferencesStore = usePreferencesStore();
  const isCutinVisible = ref(false);
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  let isHandlerAttached = false;

  /**
   * キーボードイベントハンドラー（カットインスキップ用）
   */
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (isCutinVisible.value) {
      // カットイン表示中は全てのキー入力でスキップ
      event.stopPropagation();
      event.preventDefault();
      hideCutin();
    }
  };

  /**
   * カットインを表示
   */
  const showCutin = (_type: CutinType): void => {
    if (!cutinRef.value) {
      return;
    }

    // 既存のカットインが表示中なら即座に閉じる
    if (isCutinVisible.value) {
      hideCutin();
    }

    isCutinVisible.value = true;
    cutinRef.value.showPopover();

    // キーボードリスナーが未登録ならば登録
    if (!isHandlerAttached) {
      window.addEventListener("keydown", handleKeyDown, { capture: true });
      isHandlerAttached = true;
    }

    // 自動消滅タイマーを設定（秒→ミリ秒に変換）
    const durationMs = preferencesStore.cutinDisplayDuration * 1000;
    autoHideTimer = setTimeout(() => {
      hideCutin();
    }, durationMs);
  };

  /**
   * カットインを非表示
   */
  const hideCutin = (): void => {
    if (!isCutinVisible.value) {
      return;
    }

    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }

    if (cutinRef.value) {
      cutinRef.value.hidePopover();
    }

    isCutinVisible.value = false;

    // キーボードリスナーを削除
    if (isHandlerAttached) {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      isHandlerAttached = false;
    }
  };

  /**
   * クリーンアップ
   */
  onUnmounted(() => {
    hideCutin();
  });

  return {
    isCutinVisible,
    showCutin,
    hideCutin,
  };
};
