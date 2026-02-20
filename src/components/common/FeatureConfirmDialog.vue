<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  title: string;
  message: string;
  note?: string;
  primaryText: string;
  secondaryText: string;
}>();

const emit = defineEmits<{
  primary: [];
  secondary: [];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);

const handlePrimary = (): void => {
  emit("primary");
  dialogRef.value?.close();
};

const handleSecondary = (): void => {
  emit("secondary");
  dialogRef.value?.close();
};

defineExpose({
  showModal: () => dialogRef.value?.showModal(),
  close: () => dialogRef.value?.close(),
});
</script>

<template>
  <dialog
    ref="dialogRef"
    class="feature-confirm-dialog"
    @cancel.prevent
  >
    <div class="dialog-content">
      <h2 class="dialog-title">{{ title }}</h2>
      <p class="dialog-message">{{ message }}</p>
      <p
        v-if="note"
        class="dialog-note"
      >
        {{ note }}
      </p>

      <div class="dialog-buttons">
        <button
          type="button"
          class="btn btn-secondary"
          @click="handleSecondary"
        >
          {{ secondaryText }}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          @click="handlePrimary"
        >
          {{ primaryText }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.feature-confirm-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border: none;
  border-radius: var(--size-12);
  padding: var(--size-24);
  box-shadow: 0 var(--size-10) var(--size-32) rgba(0, 0, 0, 0.2);
  width: var(--size-500);
  height: var(--size-250);
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
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: center;
}

.dialog-title {
  margin: 0 0 var(--size-12) 0;
  font-size: var(--size-20);
  color: var(--color-text-primary);
}

.dialog-message {
  margin: 0;
  font-size: var(--size-14);
  color: var(--color-text-secondary);
}

.dialog-note {
  margin: 0;
  font-size: var(--size-12);
  color: var(--color-text-secondary);
  opacity: 0.7;
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
  background-color: var(--color-miko-bg);
  color: var(--color-text-primary);
  border: 2px solid color-mix(in srgb, var(--color-miko-primary) 90%, black);

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
