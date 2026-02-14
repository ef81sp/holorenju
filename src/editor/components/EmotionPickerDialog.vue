<script setup lang="ts">
import { computed, ref } from "vue";
import {
  type CharacterType,
  type EmotionId,
  EMOTION_LABELS,
} from "@/types/character";
import CharacterSprite from "@/components/character/CharacterSprite.vue";
import { useLightDismiss } from "@/composables/useLightDismiss";

interface Props {
  character: CharacterType;
}

const emit = defineEmits<{
  select: [emotionId: EmotionId];
}>();

const props = defineProps<Props>();

const dialogRef = ref<HTMLDialogElement | null>(null);
useLightDismiss(dialogRef);

// Shows the emotion picker dialog
const showModal = (): void => {
  dialogRef.value?.showModal();
};

defineExpose({ showModal });

// Selects an emotion
const selectEmotion = (emotionId: EmotionId): void => {
  emit("select", emotionId);
  dialogRef.value?.close();
};

// All 40 emotion IDs
const allEmotionIds = computed<EmotionId[]>(() =>
  Array.from({ length: 40 }, (_, i) => i as EmotionId),
);

// Character name for display
const characterName = computed(() =>
  props.character === "fubuki" ? "フブキ先生" : "みこ",
);
</script>

<template>
  <dialog
    ref="dialogRef"
    class="emotion-picker-dialog"
    closedby="any"
  >
    <div class="dialog-wrapper">
      <div class="dialog-header">
        <h2>{{ characterName }}の表情を選択</h2>
        <button
          class="close-button"
          aria-label="ダイアログを閉じる"
          @click="dialogRef?.close()"
        >
          ✕
        </button>
      </div>

      <div class="dialog-content">
        <!-- 4列グリッド（全40表情） -->
        <div class="emotion-grid">
          <button
            v-for="emotionId in allEmotionIds"
            :key="`emotion-${emotionId}`"
            class="emotion-cell"
            :title="`${emotionId}: ${EMOTION_LABELS[emotionId]}`"
            :aria-label="`表情${emotionId}: ${EMOTION_LABELS[emotionId]}`"
            @click="selectEmotion(emotionId)"
          >
            <CharacterSprite
              :character="character"
              :emotion-id="emotionId"
              :width="120"
              :height="120"
            />
          </button>
        </div>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.emotion-picker-dialog {
  border: none;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  max-width: 600px;
  max-height: 80vh;
  padding: 0;
  /* 中央配置 */
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.dialog-wrapper {
  display: flex;
  flex-direction: column;
  max-height: 100%;
  overflow: hidden;
}

.emotion-picker-dialog::backdrop {
  background-color: rgba(0, 0, 0, 0.5);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-m);
  border-bottom: 1px solid var(--color-border);
  min-width: 100%;
}

.dialog-header h2 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 500;
}

.close-button {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--color-text-secondary);

  &:hover {
    color: var(--color-text-primary);
  }
  overflow-y: auto;
  flex: 1;
  .active {
    border-bottom-color: var(--color-primary);
    color: var(--color-text-primary);
    font-weight: 500;
  }
}

.emotion-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--spacing-m);
}

.emotion-cell {
  padding: var(--spacing-s);
  background: var(--color-bg-secondary);
  border: 2px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--color-primary);
    background: var(--color-bg-hover);
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }
}
</style>
