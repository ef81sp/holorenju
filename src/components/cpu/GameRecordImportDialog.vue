<script setup lang="ts">
/**
 * 棋譜読み込みダイアログ
 *
 * クリップボード等から棋譜文字列を貼り付けてレビューを開く
 */

import { ref } from "vue";

import CloseIcon from "@/assets/icons/close.svg?component";
import { useLightDismiss } from "@/composables/useLightDismiss";
import { validateGameRecord } from "@/logic/gameRecordValidator";
import { convertSgfToRecord, isSgfFormat } from "@/logic/sgfParser";
import { useAppStore } from "@/stores/appStore";
import { useCpuReviewStore } from "@/stores/cpuReviewStore";
import type { PlayerSide } from "@/types/review";

const appStore = useAppStore();
const reviewStore = useCpuReviewStore();

const emit = defineEmits<{
  imported: [];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
useLightDismiss(dialogRef);

const input = ref("");
const playerSide = ref<PlayerSide>("black");
const errorMessage = ref("");

function resetState(): void {
  input.value = "";
  playerSide.value = "black";
  errorMessage.value = "";
}

function handleSubmit(): void {
  const recordToValidate = isSgfFormat(input.value)
    ? (convertSgfToRecord(input.value) ?? input.value)
    : input.value;

  const result = validateGameRecord(recordToValidate);
  if (!result.valid) {
    errorMessage.value = result.error;
    return;
  }

  errorMessage.value = "";
  reviewStore.openReviewFromImport(result.normalizedRecord, playerSide.value);
  appStore.openImportedReview();
  dialogRef.value?.close();
  emit("imported");
}

defineExpose({
  showModal: () => {
    resetState();
    dialogRef.value?.showModal();
  },
});
</script>

<template>
  <dialog
    ref="dialogRef"
    class="import-dialog"
    closedby="any"
    @keydown.esc.stop
  >
    <div class="dialog-content">
      <div class="dialog-header">
        <h2 class="dialog-title">棋譜を読み込む</h2>
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
        <textarea
          v-model="input"
          class="record-input"
          placeholder="H8 G7 I9 I8 ... / SGF形式にも対応"
          rows="3"
          autofocus
        />
        <p
          v-if="errorMessage"
          class="error-message"
        >
          {{ errorMessage }}
        </p>

        <fieldset class="side-selection">
          <legend class="side-legend">視点を選択</legend>
          <label class="side-option">
            <input
              v-model="playerSide"
              type="radio"
              name="player-side"
              value="black"
              class="visually-hidden"
            />
            <span class="side-label">先手（黒）</span>
          </label>
          <label class="side-option">
            <input
              v-model="playerSide"
              type="radio"
              name="player-side"
              value="white"
              class="visually-hidden"
            />
            <span class="side-label">後手（白）</span>
          </label>
          <label class="side-option">
            <input
              v-model="playerSide"
              type="radio"
              name="player-side"
              value="both"
              class="visually-hidden"
            />
            <span class="side-label">全手分析</span>
          </label>
          <p
            v-if="playerSide === 'both'"
            class="side-note"
          >
            通常より解析に時間がかかります
          </p>
        </fieldset>
      </div>

      <div class="dialog-footer">
        <button
          type="button"
          class="submit-button"
          @click="handleSubmit"
        >
          読み込む
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.import-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border: none;
  border-radius: var(--size-12);
  padding: 0;
  box-shadow: 0 var(--size-10) var(--size-32) rgba(0, 0, 0, 0.2);
  width: var(--size-350);
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
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--size-12) var(--size-16);
  border-bottom: 1px solid var(--color-border);
}

.dialog-title {
  margin: 0;
  font-size: var(--size-16);
  font-weight: 500;
  color: var(--color-text-primary);
}

.close-button {
  width: var(--size-28);
  height: var(--size-28);
  padding: var(--size-4);
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
  display: flex;
  flex-direction: column;
  gap: var(--size-12);
  padding: var(--size-16);
}

.record-input {
  width: 100%;
  padding: var(--size-10);
  border: var(--size-2) solid var(--color-border-light);
  border-radius: var(--size-8);
  font-family: inherit;
  font-size: var(--size-14);
  resize: none;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: var(--color-primary);
  }
}

.error-message {
  margin: 0;
  font-size: var(--size-12);
  color: var(--color-miko-primary);
}

.side-selection {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-8);
  border: none;
  padding: 0;
  margin: 0;
}

.side-legend {
  width: 100%;
  font-size: var(--size-12);
  font-weight: 500;
  color: var(--color-text-secondary);
  margin-bottom: var(--size-4);
}

.side-option {
  padding: var(--size-6) var(--size-12);
  background: var(--color-background-secondary);
  border: var(--size-2) solid transparent;
  border-radius: var(--size-8);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--color-border);
  }

  &:has(input:checked) {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
  }
}

.side-label {
  font-size: var(--size-12);
  font-weight: 500;
  color: var(--color-text-primary);
}

.side-note {
  width: 100%;
  margin: 0;
  font-size: var(--size-10);
  color: var(--color-text-secondary);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  padding: 0 var(--size-16) var(--size-16);
}

.submit-button {
  padding: var(--size-8) var(--size-20);
  background: var(--gradient-button-primary);
  border: none;
  border-radius: var(--size-8);
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    transform: translateY(calc(-1 * var(--size-2)));
    box-shadow: 0 var(--size-4) var(--size-12) rgba(0, 0, 0, 0.15);
  }

  &:active {
    transform: translateY(0);
  }
}
</style>
