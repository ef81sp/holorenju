<script setup lang="ts">
import { ref } from "vue";

// Emits
const emit = defineEmits<{
  fullscreen: [];
  close: [];
  neverShow: [neverShow: boolean];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
const neverShowAgain = ref(false);

// 全画面表示ボタンの処理
const handleFullscreen = async (): Promise<void> => {
  try {
    await document.documentElement.requestFullscreen();
    if (neverShowAgain.value) {
      emit("neverShow", true);
    }
    emit("fullscreen");
    dialogRef.value?.close();
  } catch (error) {
    console.error("全画面表示に失敗しました:", error);
  }
};

// 閉じるボタンの処理
const handleClose = (): void => {
  if (neverShowAgain.value) {
    emit("neverShow", true);
  }
  emit("close");
  dialogRef.value?.close();
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
    class="fullscreen-prompt"
  >
    <div class="dialog-content">
      <h2 class="dialog-title">📱 全画面表示のおすすめ</h2>
      <p class="dialog-message">
        快適にプレイするため、全画面表示をおすすめします。
        <br />
        より見やすくなります。
      </p>

      <div class="checkbox-container">
        <label class="checkbox-label">
          <input
            v-model="neverShowAgain"
            type="checkbox"
            class="checkbox-input"
          />
          <span class="checkbox-text">二度と表示しない</span>
        </label>
      </div>

      <div class="dialog-buttons">
        <button
          type="button"
          class="btn btn-secondary"
          @click="handleClose"
        >
          閉じる
        </button>
        <button
          type="button"
          class="btn btn-primary"
          @click="handleFullscreen"
        >
          全画面表示にする
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.fullscreen-prompt {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border: none;
  border-radius: var(--size-12);
  padding: var(--size-24);
  box-shadow: 0 var(--size-10) var(--size-32) rgba(0, 0, 0, 0.2);
  width: var(--size-500);
  min-height: var(--size-250);

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
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: center;
  gap: var(--size-16);
}

.dialog-title {
  margin: 0;
  font-size: var(--size-20);
  color: var(--color-text-primary);
}

.dialog-message {
  margin: 0;
  font-size: var(--size-14);
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.checkbox-container {
  display: flex;
  justify-content: center;
  margin: var(--size-8) 0;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: var(--size-8);
  cursor: pointer;
  user-select: none;
}

.checkbox-input {
  width: var(--size-16);
  height: var(--size-16);
  cursor: pointer;
  accent-color: var(--color-fubuki-primary);
}

.checkbox-text {
  font-size: var(--size-12);
  color: var(--color-text-secondary);
}

.dialog-buttons {
  display: flex;
  gap: var(--size-20);
  justify-content: center;
}

.btn {
  padding: var(--size-10) var(--size-20);
  border-radius: var(--size-8);
  font-size: var(--size-14);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: var(--size-150);
}

.btn-primary {
  background-color: var(--color-fubuki-bg);
  color: var(--color-text-primary);
  border: 2px solid color-mix(in srgb, var(--color-fubuki-primary) 90%, black);

  &:hover {
    filter: brightness(1.2);
    transform: translateY(-1px);
    box-shadow: 0 var(--size-4) var(--size-8) rgba(0, 0, 0, 0.15);
  }
}

.btn-secondary {
  background-color: var(--color-bg-gray);
  color: var(--color-text-primary);
  border: 2px solid var(--color-border);

  &:hover {
    filter: brightness(0.9);
    transform: translateY(-1px);
    box-shadow: 0 var(--size-4) var(--size-8) rgba(0, 0, 0, 0.15);
  }
}
</style>
