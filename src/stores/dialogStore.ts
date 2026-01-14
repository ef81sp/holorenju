/**
 * キャラクター対話管理ストア
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { DialogMessage, DialogState } from "@/types/character";

export const useDialogStore = defineStore("dialog", () => {
  // State
  const currentMessage = ref<DialogMessage | null>(null);
  const history = ref<DialogMessage[]>([]);
  const isWaitingForInput = ref(false);

  // Getters
  const dialogState = computed<DialogState>(() => ({
    currentMessage: currentMessage.value,
    history: history.value,
    isWaitingForInput: isWaitingForInput.value,
  }));

  const hasActiveDialog = computed(() => currentMessage.value !== null);

  // Actions
  function showMessage(message: DialogMessage): void {
    currentMessage.value = message;
    history.value.push(message);

    // 選択肢がある場合は入力待ち状態に
    if (message.choices && message.choices.length > 0) {
      isWaitingForInput.value = true;
    } else {
      isWaitingForInput.value = false;
    }
  }

  function clearMessage(): void {
    currentMessage.value = null;
    isWaitingForInput.value = false;
  }

  function selectChoice(choiceId: string): string | undefined {
    if (!currentMessage.value?.choices) {
      return undefined;
    }

    const choice = currentMessage.value.choices.find(
      (c: { id: string }) => c.id === choiceId,
    );
    isWaitingForInput.value = false;

    return choice?.nextDialogId ?? undefined;
  }

  function clearHistory(): void {
    history.value = [];
  }

  function reset(): void {
    currentMessage.value = null;
    history.value = [];
    isWaitingForInput.value = false;
  }

  return {
    // State
    currentMessage,
    history,
    isWaitingForInput,
    // Getters
    dialogState,
    hasActiveDialog,
    // Actions
    showMessage,
    clearMessage,
    selectChoice,
    clearHistory,
    reset,
  };
});
