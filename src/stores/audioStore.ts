/**
 * オーディオ再生管理ストア
 *
 * BGM: HTML Audio 要素でループ再生
 * SFX: HTML Audio 要素で毎回新規作成（重複再生対応）
 * preferencesStore の実効音量を watch してリアルタイムに音量を反映する。
 */

import { defineStore } from "pinia";
import { ref, watch } from "vue";

// Vite URL import
import bgmSupernovaUrl from "@/assets/bgm/SUPERNOVA.opus";
import sfxHitUrl from "@/assets/se/hit.opus";
import sfxMissUrl from "@/assets/se/miss.opus";
import sfxFanfareUrl from "@/assets/se/SSS Fanfale.opus";
import sfxSuccessUrl from "@/assets/se/success.opus";

import { usePreferencesStore } from "./preferencesStore";

export type SfxType = "stone-place" | "correct" | "incorrect" | "clear";

const SFX_MAP: Record<SfxType, string> = {
  "stone-place": sfxHitUrl,
  correct: sfxSuccessUrl,
  incorrect: sfxMissUrl,
  clear: sfxFanfareUrl,
};

export const useAudioStore = defineStore("audio", () => {
  const preferencesStore = usePreferencesStore();

  // BGM の Audio インスタンス（シングルトン）
  let bgmAudio: HTMLAudioElement | null = null;
  const isBgmPlaying = ref(false);

  // 自動再生ポリシーでブロックされた場合のリトライ用
  let bgmPendingPlay = false;
  let resumeListenerAttached = false;

  // SFXダッキング: SFX再生中はBGM音量を下げる
  const BGM_DUCK_RATIO = 0.1;
  let activeSfxCount = 0;
  let duckRestoreTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * ユーザー操作リスナーを登録（一度だけ）
   * 自動再生がブロックされた場合、次のユーザー操作で再生を試みる
   */
  function attachResumeListener(): void {
    if (resumeListenerAttached) {
      return;
    }
    resumeListenerAttached = true;
    const events = ["click", "keydown", "touchstart"] as const;
    const handler = (): void => {
      if (bgmPendingPlay) {
        playBgm();
      }
      for (const event of events) {
        document.removeEventListener(event, handler);
      }
      resumeListenerAttached = false;
    };
    for (const event of events) {
      document.addEventListener(event, handler, { once: false });
    }
  }

  /**
   * BGM用の Audio 要素を取得（シングルトン）
   */
  function ensureBgmAudio(): HTMLAudioElement {
    if (!bgmAudio) {
      bgmAudio = new Audio(bgmSupernovaUrl);
      bgmAudio.loop = true;
    }
    return bgmAudio;
  }

  /**
   * BGMの実際の音量を更新（ダッキング考慮）
   */
  function applyBgmVolume(): void {
    if (!bgmAudio) {
      return;
    }
    const base = preferencesStore.effectiveBgmVolume;
    bgmAudio.volume = activeSfxCount > 0 ? base * BGM_DUCK_RATIO : base;
  }

  /**
   * SFX再生開始時: BGM音量を下げる
   */
  function duckBgm(): void {
    if (duckRestoreTimer !== null) {
      clearTimeout(duckRestoreTimer);
      duckRestoreTimer = null;
    }
    activeSfxCount++;
    applyBgmVolume();
  }

  /**
   * SFX再生終了時: 全SFX終了後にBGM音量を戻す
   */
  function unduckBgm(): void {
    activeSfxCount = Math.max(0, activeSfxCount - 1);
    if (activeSfxCount === 0) {
      // 少し遅延させてから戻す（連続SFX時のちらつき防止）
      duckRestoreTimer = setTimeout(() => {
        duckRestoreTimer = null;
        applyBgmVolume();
      }, 100);
    }
  }

  /**
   * BGMを再生開始
   */
  function playBgm(): void {
    if (preferencesStore.effectiveBgmVolume <= 0) {
      return;
    }

    // 既に再生中なら何もしない
    if (isBgmPlaying.value) {
      return;
    }

    const audio = ensureBgmAudio();
    applyBgmVolume();

    const playPromise = audio.play();
    if (playPromise) {
      playPromise
        .then(() => {
          isBgmPlaying.value = true;
          bgmPendingPlay = false;
        })
        .catch(() => {
          // 自動再生ポリシーでブロック → ユーザー操作時にリトライ
          bgmPendingPlay = true;
          attachResumeListener();
        });
    }
  }

  /**
   * BGMを停止
   */
  function stopBgm(): void {
    bgmPendingPlay = false;
    if (bgmAudio) {
      bgmAudio.pause();
      bgmAudio.currentTime = 0;
    }
    isBgmPlaying.value = false;
  }

  /**
   * 効果音を再生
   * 毎回新しい Audio を作成して重複再生に対応する
   * stone-place はダッキングなし（BGM音量を下げない）
   */
  function playSfx(type: SfxType): void {
    const volume = preferencesStore.effectiveSfxVolume;
    if (volume <= 0) {
      return;
    }

    const url = SFX_MAP[type];
    const audio = new Audio(url);
    audio.volume = volume;

    const shouldDuck = type !== "stone-place";

    if (shouldDuck) {
      duckBgm();
    }

    audio.play().catch(() => {
      if (shouldDuck) {
        unduckBgm();
      }
    });

    audio.addEventListener("ended", () => {
      if (shouldDuck) {
        unduckBgm();
      }
      audio.src = "";
    });
  }

  /**
   * 全SFXをプリロード
   */
  function preloadSfx(): void {
    for (const url of Object.values(SFX_MAP)) {
      const audio = new Audio();
      audio.src = url;
      audio.load();
    }
  }

  /**
   * クリーンアップ
   */
  function dispose(): void {
    stopBgm();
    if (bgmAudio) {
      bgmAudio.src = "";
      bgmAudio = null;
    }
  }

  // effectiveBgmVolume の変化を watch して再生中BGMの音量をリアルタイム反映
  watch(
    () => preferencesStore.effectiveBgmVolume,
    (volume) => {
      applyBgmVolume();

      if (volume <= 0 && isBgmPlaying.value) {
        bgmAudio?.pause();
        isBgmPlaying.value = false;
      } else if (volume > 0 && !isBgmPlaying.value && bgmAudio) {
        bgmAudio.play().catch(() => {
          // 自動再生ポリシーでブロックされた場合は無視
        });
        isBgmPlaying.value = true;
      }
    },
  );

  return {
    isBgmPlaying,
    playBgm,
    stopBgm,
    playSfx,
    preloadSfx,
    dispose,
  };
});
