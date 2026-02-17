import { useMediaQuery } from "@vueuse/core";
import { computed, type ShallowRef, type ComputedRef } from "vue";

const STORAGE_KEY = "holorenju-fullscreen-prompt-disabled";

/**
 * FullscreenPromptコンポーネントが公開するメソッド
 */
interface FullscreenPromptRef {
  showModal(): void | undefined;
}

export const useFullscreenPrompt = (
  promptRef: Readonly<ShallowRef<FullscreenPromptRef | null | undefined>>,
): {
  isMobile: ComputedRef<boolean>;
  isPromptDisabled: () => boolean;
  showFullscreenPrompt: () => void;
  handleNeverShow: () => void;
} => {
  // スマホ判定（メディアクエリ or タッチポイント数）
  const isMobileByMedia = useMediaQuery("(hover: none) and (pointer: coarse)");
  const hasTouchPoints = navigator.maxTouchPoints > 0;
  const isMobile = computed(() => isMobileByMedia.value || hasTouchPoints);

  // LocalStorageの確認
  const isPromptDisabled = (): boolean => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  };

  // PWA判定（standaloneまたはfullscreenモードで起動済み）
  const isPWA =
    typeof matchMedia === "function" &&
    (matchMedia("(display-mode: standalone)").matches ||
      matchMedia("(display-mode: fullscreen)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  // 全画面表示プロンプトを表示（PWA起動時はスキップ）
  const showFullscreenPrompt = (): void => {
    if (isPWA) {
      return;
    }
    if (isMobile.value && !isPromptDisabled()) {
      promptRef.value?.showModal();
    }
  };

  // 「二度と表示しない」フラグを保存
  const handleNeverShow = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Safari プライベートブラウジング等で使用不可の場合は無視
    }
  };

  return {
    isMobile,
    showFullscreenPrompt,
    isPromptDisabled,
    handleNeverShow,
  };
};
