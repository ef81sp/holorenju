<script setup lang="ts">
import { ref } from "vue";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useProgressStore } from "@/stores/progressStore";
// oxlint-disable-next-line consistent-type-imports
import ConfirmDialog from "./ConfirmDialog.vue";

const preferencesStore = usePreferencesStore();
const progressStore = useProgressStore();

const dialogRef = ref<HTMLDialogElement | null>(null);
const confirmDialogRef = ref<InstanceType<typeof ConfirmDialog> | null>(null);

// ラベル定義
const speedLabels = {
  slow: "遅い",
  normal: "標準",
  fast: "速い",
} as const;

const textSizeLabels = {
  small: "小",
  normal: "標準",
  large: "大",
} as const;

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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line
              x1="18"
              y1="6"
              x2="6"
              y2="18"
            />
            <line
              x1="6"
              y1="6"
              x2="18"
              y2="18"
            />
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- アニメーション設定 -->
        <section class="settings-section">
          <h3 class="section-title">アニメーション</h3>
          <div class="settings-group">
            <label class="setting-row">
              <span class="setting-label">アニメーション有効</span>
              <input
                v-model="preferencesStore.animationEnabled"
                type="checkbox"
                class="checkbox"
              />
            </label>
            <label class="setting-row">
              <span class="setting-label">石の配置速度</span>
              <select
                v-model="preferencesStore.stoneSpeed"
                class="select"
                :disabled="!preferencesStore.animationEnabled"
              >
                <option value="slow">{{ speedLabels.slow }}</option>
                <option value="normal">{{ speedLabels.normal }}</option>
                <option value="fast">{{ speedLabels.fast }}</option>
              </select>
            </label>
          </div>
        </section>

        <!-- 表示設定 -->
        <section class="settings-section">
          <h3 class="section-title">表示</h3>
          <div class="settings-group">
            <label class="setting-row">
              <span class="setting-label">テキストサイズ</span>
              <select
                v-model="preferencesStore.textSize"
                class="select"
              >
                <option value="small">{{ textSizeLabels.small }}</option>
                <option value="normal">{{ textSizeLabels.normal }}</option>
                <option value="large">{{ textSizeLabels.large }}</option>
              </select>
            </label>
          </div>
        </section>

        <!-- データ管理 -->
        <section class="settings-section">
          <h3 class="section-title">データ管理</h3>
          <div class="settings-group">
            <div class="setting-row">
              <span class="setting-label">学習の進度をリセット</span>
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
  max-height: 80%;
  overflow: hidden;

  transition:
    opacity 0.15s ease-out,
    transform 0.15s ease-out,
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
  height: 100%;
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
  padding: var(--size-12) 0;
  cursor: pointer;

  &:not(:last-child) {
    border-bottom: 1px solid var(--color-border);
  }
}

.setting-label {
  font-size: var(--size-14);
  color: var(--color-text-primary);
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
