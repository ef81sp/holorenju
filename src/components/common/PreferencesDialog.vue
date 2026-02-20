<script setup lang="ts">
import { ref } from "vue";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useProgressStore } from "@/stores/progressStore";
import { useAudioStore } from "@/stores/audioStore";
// oxlint-disable-next-line consistent-type-imports
import ConfirmDialog from "./ConfirmDialog.vue";
import CloseIcon from "@/assets/icons/close.svg?component";
import { useLightDismiss } from "@/composables/useLightDismiss";

const preferencesStore = usePreferencesStore();
const progressStore = useProgressStore();
const audioStore = useAudioStore();

const dialogRef = ref<HTMLDialogElement | null>(null);
useLightDismiss(dialogRef);
const confirmDialogRef = ref<InstanceType<typeof ConfirmDialog> | null>(null);

// ラベル定義
const speedLabels = {
  slowest: "超ゆっくり",
  slow: "ゆっくり",
  normal: "標準",
  fast: "速い",
  fastest: "超速い",
} as const;

const textSizeLabels = {
  normal: "標準",
  large: "大",
} as const;

const largeBoardScopeLabels = {
  cpuPlay: "ホロメン対戦のみ",
  question: "問題のみ",
  both: "両方",
} as const;

// 盤面拡大モードの切り替え
const handleLargeBoardEnabledChange = (event: Event): void => {
  const { checked } = event.target as HTMLInputElement;
  preferencesStore.largeBoardEnabled = checked;
  preferencesStore.largeBoardHasBeenAsked = true;
};

// オーディオ有効/無効の切り替え
const handleAudioEnabledChange = (event: Event): void => {
  const { checked } = event.target as HTMLInputElement;
  preferencesStore.audioEnabled = checked;
  preferencesStore.audioHasBeenAsked = true;
  if (checked) {
    audioStore.preloadSfx();
    audioStore.playBgm();
  } else {
    audioStore.stopBgm();
  }
};

// 進度リセット確認
const handleResetClick = (): void => {
  confirmDialogRef.value?.showModal();
};

const handleConfirmReset = (): void => {
  progressStore.resetProgress();
};

// メソッドをexposeする
defineExpose({
  showModal: () => dialogRef.value?.showModal(),
  close: () => dialogRef.value?.close(),
});
</script>

<template>
  <dialog
    ref="dialogRef"
    class="preferences-dialog"
    closedby="any"
  >
    <div class="dialog-content">
      <div class="dialog-header">
        <h2 class="dialog-title">設定</h2>
        <button
          type="button"
          class="close-button"
          aria-label="閉じる"
          @click="dialogRef?.close()"
        >
          <CloseIcon />
        </button>
      </div>

      <div class="dialog-body">
        <!-- アニメーション設定 -->
        <section class="settings-section">
          <h3 class="section-title">アニメーション</h3>
          <div class="settings-group">
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">アニメーション有効</span>
                <span class="setting-description">動きを滑らかに表示</span>
              </span>
              <input
                v-model="preferencesStore.animationEnabled"
                type="checkbox"
                class="checkbox"
              />
            </label>
            <hr class="setting-divider" />
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">アニメーション速度</span>
                <span class="setting-description">石の配置の速さ</span>
              </span>
              <select
                v-model="preferencesStore.speed"
                class="select"
                :disabled="!preferencesStore.animationEnabled"
              >
                <option value="slowest">{{ speedLabels.slowest }}</option>
                <option value="slow">{{ speedLabels.slow }}</option>
                <option value="normal">{{ speedLabels.normal }}</option>
                <option value="fast">{{ speedLabels.fast }}</option>
                <option value="fastest">{{ speedLabels.fastest }}</option>
              </select>
            </label>
            <hr class="setting-divider" />
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">演出速度</span>
                <span class="setting-description">
                  カットイン表示・ダイアログ等のアニメーションの速さ
                </span>
              </span>
              <select
                v-model="preferencesStore.effectSpeed"
                class="select"
                :disabled="!preferencesStore.animationEnabled"
              >
                <option value="slowest">{{ speedLabels.slowest }}</option>
                <option value="slow">{{ speedLabels.slow }}</option>
                <option value="normal">{{ speedLabels.normal }}</option>
                <option value="fast">{{ speedLabels.fast }}</option>
                <option value="fastest">{{ speedLabels.fastest }}</option>
              </select>
            </label>
          </div>
        </section>

        <!-- サウンド設定 -->
        <section class="settings-section">
          <h3 class="section-title">サウンド</h3>
          <div class="settings-group">
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">音を再生する</span>
                <span class="setting-description">BGMと効果音を有効にする</span>
              </span>
              <input
                :checked="preferencesStore.audioEnabled"
                type="checkbox"
                class="checkbox"
                @change="handleAudioEnabledChange"
              />
            </label>
            <hr class="setting-divider" />
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">マスター音量</span>
              </span>
              <input
                v-model.number="preferencesStore.masterVolume"
                type="range"
                class="range"
                min="0"
                max="1"
                step="0.1"
                :disabled="!preferencesStore.audioEnabled"
              />
            </label>
            <hr class="setting-divider" />
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">BGM</span>
              </span>
              <input
                v-model="preferencesStore.bgmEnabled"
                type="checkbox"
                class="checkbox"
                :disabled="!preferencesStore.audioEnabled"
              />
            </label>
            <hr class="setting-divider" />
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">BGM音量</span>
              </span>
              <input
                v-model.number="preferencesStore.bgmVolume"
                type="range"
                class="range"
                min="0"
                max="1"
                step="0.1"
                :disabled="
                  !preferencesStore.audioEnabled || !preferencesStore.bgmEnabled
                "
              />
            </label>
            <hr class="setting-divider" />
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">効果音</span>
              </span>
              <input
                v-model="preferencesStore.sfxEnabled"
                type="checkbox"
                class="checkbox"
                :disabled="!preferencesStore.audioEnabled"
              />
            </label>
            <hr class="setting-divider" />
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">効果音音量</span>
              </span>
              <input
                v-model.number="preferencesStore.sfxVolume"
                type="range"
                class="range"
                min="0"
                max="1"
                step="0.1"
                :disabled="
                  !preferencesStore.audioEnabled || !preferencesStore.sfxEnabled
                "
              />
            </label>
          </div>
        </section>

        <!-- 表示設定 -->
        <section class="settings-section">
          <h3 class="section-title">表示</h3>
          <div class="settings-group">
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">テキストサイズ</span>
                <span class="setting-description">セリフの大きさ</span>
              </span>
              <select
                v-model="preferencesStore.textSize"
                class="select"
              >
                <option value="normal">{{ textSizeLabels.normal }}</option>
                <option value="large">{{ textSizeLabels.large }}</option>
              </select>
            </label>
            <hr class="setting-divider" />
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">盤面拡大モード</span>
                <span class="setting-description">
                  盤面を大きく表示（スマホ向け）
                </span>
              </span>
              <input
                :checked="preferencesStore.largeBoardEnabled"
                type="checkbox"
                class="checkbox"
                @change="handleLargeBoardEnabledChange"
              />
            </label>
            <hr class="setting-divider" />
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">拡大の対象</span>
              </span>
              <select
                v-model="preferencesStore.largeBoardScope"
                class="select"
                :disabled="!preferencesStore.largeBoardEnabled"
              >
                <option value="cpuPlay">
                  {{ largeBoardScopeLabels.cpuPlay }}
                </option>
                <option value="question">
                  {{ largeBoardScopeLabels.question }}
                </option>
                <option value="both">
                  {{ largeBoardScopeLabels.both }}
                </option>
              </select>
            </label>
          </div>
        </section>

        <!-- アクセシビリティ -->
        <section class="settings-section">
          <h3 class="section-title">アクセシビリティ</h3>
          <div class="settings-group">
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">盤面の読み上げ</span>
                <span class="setting-description">
                  カーソル移動時に座標と石の状態を読み上げ
                </span>
              </span>
              <input
                v-model="preferencesStore.boardAnnounce"
                type="checkbox"
                class="checkbox"
              />
            </label>
          </div>
        </section>

        <!-- CPU対戦 -->
        <section class="settings-section">
          <h3 class="section-title">ホロメン対戦</h3>
          <div class="settings-group">
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">可能な限り早く着手</span>
                <span class="setting-description">思考時間を短縮</span>
              </span>
              <input
                v-model="preferencesStore.fastCpuMove"
                type="checkbox"
                class="checkbox"
              />
            </label>
          </div>
        </section>

        <!-- データ管理 -->
        <section class="settings-section">
          <h3 class="section-title">データ管理</h3>
          <div class="settings-group">
            <div class="setting-row">
              <span class="setting-text">
                <span class="setting-label">学習の進度をリセット</span>
                <span class="setting-description">元に戻せません</span>
              </span>
              <button
                type="button"
                class="btn btn-danger"
                @click="handleResetClick"
              >
                リセット
              </button>
            </div>
          </div>
        </section>

        <!-- 開発者向け -->
        <section class="settings-section">
          <h3 class="section-title">開発者向け</h3>
          <div class="settings-group">
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-label">コンピュータ分析を表示</span>
                <span class="setting-description">デバッグ情報を表示</span>
              </span>
              <input
                v-model="preferencesStore.showCpuInfo"
                type="checkbox"
                class="checkbox"
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  </dialog>

  <!-- リセット確認ダイアログ -->
  <ConfirmDialog
    ref="confirmDialogRef"
    title="進度をリセットしますか？"
    message="すべての学習進度がリセットされます。この操作は元に戻せません。"
    confirm-text="リセット"
    cancel-text="キャンセル"
    @confirm="handleConfirmReset"
  />
</template>

<style scoped>
.preferences-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border: none;
  border-radius: var(--size-12);
  padding: 0;
  box-shadow: 0 var(--size-10) var(--size-32) rgba(0, 0, 0, 0.2);
  width: var(--size-500);
  height: calc(var(--effective-vw) * 9 / 16 * 0.85);
  overflow: hidden;
  opacity: 0;

  transition:
    opacity 0.15s ease-out,
    overlay 0.15s ease-out allow-discrete,
    display 0.15s ease-out allow-discrete;

  &[open] {
    opacity: 1;

    @starting-style {
      opacity: 0;
    }
  }

  &::backdrop {
    background: rgba(0, 0, 0, 0.5);
    opacity: 0;
    transition:
      opacity 0.15s ease-out,
      overlay 0.15s ease-out allow-discrete,
      display 0.15s ease-out allow-discrete;
  }

  &[open]::backdrop {
    opacity: 1;

    @starting-style {
      opacity: 0;
    }
  }
}

.dialog-content {
  display: flex;
  flex-direction: column;
  max-height: 100%;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--size-16) var(--size-24);
  border-bottom: 1px solid var(--color-border);
}

.dialog-title {
  margin: 0;
  font-size: var(--size-20);
  font-weight: 500;
  color: var(--color-text-primary);
}

.close-button {
  width: var(--size-32);
  height: var(--size-32);
  padding: var(--size-6);
  background: transparent;
  border: none;
  border-radius: var(--size-6);
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: all 0.15s ease;

  &:hover {
    background: var(--color-bg-gray);
    color: var(--color-text-primary);
  }

  svg {
    width: 100%;
    height: 100%;
  }
}

.dialog-body {
  padding: var(--size-24);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.settings-section {
  &:not(:last-child) {
    margin-bottom: var(--size-24);
  }
}

.section-title {
  margin: 0 0 var(--size-12) 0;
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-secondary);
}

.settings-group {
  background: var(--color-bg-gray);
  border-radius: var(--size-8);
  padding: var(--size-4) var(--size-16);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-16);
  padding: var(--size-12) 0;
  cursor: pointer;
}

.setting-text {
  flex: 1;
  min-width: 0;
}

.setting-label {
  display: block;
  font-size: var(--size-14);
  color: var(--color-text-primary);
}

.setting-description {
  display: block;
  font-size: var(--size-12);
  color: var(--color-text-secondary);
}

.setting-divider {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 0;
}

.checkbox {
  width: var(--size-20);
  height: var(--size-20);
  accent-color: var(--color-holo-blue);
  cursor: pointer;
}

.select {
  padding: var(--size-6) var(--size-12);
  font-size: var(--size-14);
  border: 1px solid var(--color-border);
  border-radius: var(--size-6);
  background: var(--color-bg-white);
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.range {
  width: var(--size-120);
  accent-color: var(--color-holo-blue);
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn {
  padding: var(--size-8) var(--size-16);
  border-radius: var(--size-6);
  font-size: var(--size-14);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-danger {
  background-color: #ff6b6b;
  color: white;
  border: none;

  &:hover {
    background-color: #ee5a5a;
  }
}
</style>
