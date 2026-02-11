/**
 * 設定管理ストア
 */

import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

const STORAGE_KEY = "holorenju_preferences";

export type AnimationSpeed = "slowest" | "slow" | "normal" | "fast" | "fastest";
export type TextSize = "normal" | "large";

interface Preferences {
  animation: {
    enabled: boolean;
    speed: AnimationSpeed; // 石・マーク・ライン
    effectSpeed: AnimationSpeed; // キャラクター・ダイアログ・カットイン
  };
  audio: {
    enabled: boolean; // マスタースイッチ（初回確認まではfalse）
    hasBeenAsked: boolean; // 初回確認済みフラグ
    masterVolume: number; // 0.0-1.0
    bgmEnabled: boolean;
    bgmVolume: number; // 0.0-1.0
    sfxEnabled: boolean;
    sfxVolume: number; // 0.0-1.0
  };
  display: {
    textSize: TextSize;
  };
  cpu: {
    fastMove: boolean;
  };
  debug: {
    showCpuInfo: boolean;
  };
}

const defaultPreferences: Preferences = {
  animation: {
    enabled: true,
    speed: "normal",
    effectSpeed: "normal",
  },
  audio: {
    enabled: false,
    hasBeenAsked: false,
    masterVolume: 0.8,
    bgmEnabled: true,
    bgmVolume: 0.3,
    sfxEnabled: true,
    sfxVolume: 0.7,
  },
  display: {
    textSize: "normal",
  },
  cpu: {
    fastMove: false,
  },
  debug: {
    showCpuInfo: false,
  },
};

/**
 * 速度設定ごとの倍率
 */
const SPEED_MULTIPLIERS: Record<AnimationSpeed, number> = {
  slowest: 2.0,
  slow: 1.5,
  normal: 1.0,
  fast: 0.5,
  fastest: 0.25,
};

/**
 * 基準アニメーション時間（秒）
 * normal (x1.0) の場合の時間
 */
const BASE_DURATIONS = {
  stone: 0.4,
  mark: 0.5,
  line: 0.4,
} as const;

/**
 * 基準演出時間（秒）
 */
const BASE_EFFECT_DURATIONS = {
  character: 0.3,
  dialog: 0.15,
  sprite: 0.3,
  cutinOverlay: 0.2,
  cutinDisplay: 0.8, // カットイン表示時間
} as const;

/**
 * 旧設定からのマイグレーション
 * stoneSpeed を speed / effectSpeed に変換
 */
type OldStoneSpeed = "slow" | "normal" | "fast";
interface OldPreferences {
  animation?: {
    enabled?: boolean;
    stoneSpeed?: OldStoneSpeed;
    speed?: AnimationSpeed;
    effectSpeed?: AnimationSpeed;
  };
  display?: {
    textSize?: TextSize;
  };
  cpu?: {
    fastMove?: boolean;
  };
  debug?: {
    showCpuInfo?: boolean;
  };
}

function migrateFromOldFormat(parsed: OldPreferences): Preferences {
  const animation = parsed.animation ?? {};

  // 既に新形式であればそのまま使用
  if (animation.speed !== undefined && animation.effectSpeed !== undefined) {
    return {
      animation: {
        enabled: animation.enabled ?? defaultPreferences.animation.enabled,
        speed: animation.speed,
        effectSpeed: animation.effectSpeed,
      },
      audio: {
        ...defaultPreferences.audio,
        ...((parsed as Record<string, unknown>).audio as
          | Preferences["audio"]
          | undefined),
      },
      display: { ...defaultPreferences.display, ...parsed.display },
      cpu: { ...defaultPreferences.cpu, ...parsed.cpu },
      debug: { ...defaultPreferences.debug, ...parsed.debug },
    };
  }

  // 旧形式からマイグレーション
  const oldSpeed = animation.stoneSpeed;
  let newSpeed: AnimationSpeed = "normal";
  let newEffectSpeed: AnimationSpeed = "normal";

  if (oldSpeed === "slow") {
    // 旧slow (0.4s) → 新normal (0.4s)
    newSpeed = "normal";
    newEffectSpeed = "normal";
  } else if (oldSpeed === "normal") {
    // 旧normal (0.2s) → 新fast (0.2s)
    newSpeed = "fast";
    newEffectSpeed = "fast";
  } else if (oldSpeed === "fast") {
    // 旧fast (0.1s) → 新fastest (0.1s)
    newSpeed = "fastest";
    newEffectSpeed = "fastest";
  }

  return {
    animation: {
      enabled: animation.enabled ?? defaultPreferences.animation.enabled,
      speed: newSpeed,
      effectSpeed: newEffectSpeed,
    },
    audio: { ...defaultPreferences.audio },
    display: { ...defaultPreferences.display, ...parsed.display },
    cpu: { ...defaultPreferences.cpu, ...parsed.cpu },
    debug: { ...defaultPreferences.debug, ...parsed.debug },
  };
}

export const usePreferencesStore = defineStore("preferences", () => {
  // State
  const preferences = ref<Preferences>(loadFromStorage());

  function loadFromStorage(): Preferences {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as OldPreferences;
        const migrated = migrateFromOldFormat(parsed);
        // マイグレーション後、新形式で即座に保存
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
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

  const speed = computed({
    get: () => preferences.value.animation.speed,
    set: (v) => (preferences.value.animation.speed = v),
  });

  const effectSpeed = computed({
    get: () => preferences.value.animation.effectSpeed,
    set: (v) => (preferences.value.animation.effectSpeed = v),
  });

  const textSize = computed({
    get: () => preferences.value.display.textSize,
    set: (v) => (preferences.value.display.textSize = v),
  });

  const fastCpuMove = computed({
    get: () => preferences.value.cpu.fastMove,
    set: (v) => (preferences.value.cpu.fastMove = v),
  });

  const showCpuInfo = computed({
    get: () => preferences.value.debug.showCpuInfo,
    set: (v) => (preferences.value.debug.showCpuInfo = v),
  });

  // Audio getter/setter
  const audioEnabled = computed({
    get: () => preferences.value.audio.enabled,
    set: (v) => (preferences.value.audio.enabled = v),
  });

  const audioHasBeenAsked = computed({
    get: () => preferences.value.audio.hasBeenAsked,
    set: (v) => (preferences.value.audio.hasBeenAsked = v),
  });

  const masterVolume = computed({
    get: () => preferences.value.audio.masterVolume,
    set: (v) => (preferences.value.audio.masterVolume = v),
  });

  const bgmEnabled = computed({
    get: () => preferences.value.audio.bgmEnabled,
    set: (v) => (preferences.value.audio.bgmEnabled = v),
  });

  const bgmVolume = computed({
    get: () => preferences.value.audio.bgmVolume,
    set: (v) => (preferences.value.audio.bgmVolume = v),
  });

  const sfxEnabled = computed({
    get: () => preferences.value.audio.sfxEnabled,
    set: (v) => (preferences.value.audio.sfxEnabled = v),
  });

  const sfxVolume = computed({
    get: () => preferences.value.audio.sfxVolume,
    set: (v) => (preferences.value.audio.sfxVolume = v),
  });

  // 実効音量
  const effectiveBgmVolume = computed(() =>
    preferences.value.audio.enabled && preferences.value.audio.bgmEnabled
      ? preferences.value.audio.masterVolume * preferences.value.audio.bgmVolume
      : 0,
  );

  const effectiveSfxVolume = computed(() =>
    preferences.value.audio.enabled && preferences.value.audio.sfxEnabled
      ? preferences.value.audio.masterVolume * preferences.value.audio.sfxVolume
      : 0,
  );

  // 速度倍率
  const speedMultiplier = computed(
    () => SPEED_MULTIPLIERS[preferences.value.animation.speed],
  );
  const effectSpeedMultiplier = computed(
    () => SPEED_MULTIPLIERS[preferences.value.animation.effectSpeed],
  );

  // アニメーション時間（秒単位）
  const stoneAnimationDuration = computed(() => {
    if (!preferences.value.animation.enabled) {
      return 0;
    }
    return BASE_DURATIONS.stone * speedMultiplier.value;
  });

  const markAnimationDuration = computed(() => {
    if (!preferences.value.animation.enabled) {
      return 0;
    }
    return BASE_DURATIONS.mark * speedMultiplier.value;
  });

  const lineAnimationDuration = computed(() => {
    if (!preferences.value.animation.enabled) {
      return 0;
    }
    return BASE_DURATIONS.line * speedMultiplier.value;
  });

  // 演出時間（秒単位）
  const characterAnimationDuration = computed(
    () => BASE_EFFECT_DURATIONS.character * effectSpeedMultiplier.value,
  );

  const dialogAnimationDuration = computed(
    () => BASE_EFFECT_DURATIONS.dialog * effectSpeedMultiplier.value,
  );

  const spriteAnimationDuration = computed(
    () => BASE_EFFECT_DURATIONS.sprite * effectSpeedMultiplier.value,
  );

  const cutinOverlayDuration = computed(
    () => BASE_EFFECT_DURATIONS.cutinOverlay * effectSpeedMultiplier.value,
  );

  const cutinDisplayDuration = computed(
    () => BASE_EFFECT_DURATIONS.cutinDisplay * effectSpeedMultiplier.value,
  );

  return {
    // State
    preferences,
    // 個別のgetter/setter
    animationEnabled,
    speed,
    effectSpeed,
    textSize,
    fastCpuMove,
    showCpuInfo,
    // Audio
    audioEnabled,
    audioHasBeenAsked,
    masterVolume,
    bgmEnabled,
    bgmVolume,
    sfxEnabled,
    sfxVolume,
    effectiveBgmVolume,
    effectiveSfxVolume,
    // 速度倍率
    speedMultiplier,
    effectSpeedMultiplier,
    // 計算されたアニメーション時間
    stoneAnimationDuration,
    markAnimationDuration,
    lineAnimationDuration,
    // 計算された演出時間
    characterAnimationDuration,
    dialogAnimationDuration,
    spriteAnimationDuration,
    cutinOverlayDuration,
    cutinDisplayDuration,
  };
});
