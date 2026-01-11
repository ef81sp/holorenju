/**
 * 設定管理ストア
 */

import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

const STORAGE_KEY = "holorenju_preferences";

export type StoneSpeed = "slow" | "normal" | "fast";
export type TextSize = "small" | "normal" | "large";

interface Preferences {
  animation: {
    enabled: boolean;
    stoneSpeed: StoneSpeed;
  };
  display: {
    textSize: TextSize;
  };
}

const defaultPreferences: Preferences = {
  animation: {
    enabled: true,
    stoneSpeed: "normal",
  },
  display: {
    textSize: "normal",
  },
};

export const usePreferencesStore = defineStore("preferences", () => {
  // State
  const preferences = ref<Preferences>(loadFromStorage());

  function loadFromStorage(): Preferences {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // デフォルト値とマージ（将来の項目追加に対応）
        return {
          animation: { ...defaultPreferences.animation, ...parsed.animation },
          display: { ...defaultPreferences.display, ...parsed.display },
        };
      } catch {
        return { ...defaultPreferences };
      }
    }
    return { ...defaultPreferences };
  }

  function saveToStorage(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences.value));
  }

  // 変更時に自動保存
  watch(preferences, saveToStorage, { deep: true });

  // 個別のgetter/setter
  const animationEnabled = computed({
    get: () => preferences.value.animation.enabled,
    set: (v) => (preferences.value.animation.enabled = v),
  });

  const stoneSpeed = computed({
    get: () => preferences.value.animation.stoneSpeed,
    set: (v) => (preferences.value.animation.stoneSpeed = v),
  });

  const textSize = computed({
    get: () => preferences.value.display.textSize,
    set: (v) => (preferences.value.display.textSize = v),
  });

  // 速度値のマッピング（秒単位）
  const stoneAnimationDuration = computed(() => {
    if (!preferences.value.animation.enabled) {
      return 0;
    }
    const speeds: Record<StoneSpeed, number> = {
      slow: 0.4,
      normal: 0.2,
      fast: 0.1,
    };
    return speeds[preferences.value.animation.stoneSpeed];
  });

  // マーク・ラインのアニメーション時間
  const markAnimationDuration = computed(() => {
    if (!preferences.value.animation.enabled) {
      return 0;
    }
    const speeds: Record<StoneSpeed, number> = {
      slow: 0.5,
      normal: 0.25,
      fast: 0.125,
    };
    return speeds[preferences.value.animation.stoneSpeed];
  });

  const lineAnimationDuration = computed(() => {
    if (!preferences.value.animation.enabled) {
      return 0;
    }
    const speeds: Record<StoneSpeed, number> = {
      slow: 0.4,
      normal: 0.2,
      fast: 0.1,
    };
    return speeds[preferences.value.animation.stoneSpeed];
  });

  return {
    // State
    preferences,
    // 個別のgetter/setter
    animationEnabled,
    stoneSpeed,
    textSize,
    // 計算されたアニメーション時間
    stoneAnimationDuration,
    markAnimationDuration,
    lineAnimationDuration,
  };
});
