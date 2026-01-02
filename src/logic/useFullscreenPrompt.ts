import { useMediaQuery } from "@vueuse/core";
import { computed, type ShallowRef, type ComputedRef } from "vue";

import type FullscreenPrompt from "@/components/common/FullscreenPrompt.vue";

const STORAGE_KEY = "holorenju-fullscreen-prompt-disabled";

export const useFullscreenPrompt = (
  promptRef: ShallowRef<InstanceType<typeof FullscreenPrompt> | null>,
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
  const isPromptDisabled = (): boolean =>
    localStorage.getItem(STORAGE_KEY) === "true";

  // 全画面表示プロンプトを表示
  const showFullscreenPrompt = (): void => {
    if (isMobile.value && !isPromptDisabled()) {
      promptRef.value?.showModal();
    }
  };

  // 「二度と表示しない」フラグを保存
  const handleNeverShow = (): void => {
    localStorage.setItem(STORAGE_KEY, "true");
  };

  return {
    isMobile,
    showFullscreenPrompt,
    isPromptDisabled,
    handleNeverShow,
  };
};
