<script setup lang="ts">
import { ref } from "vue";
import type { DialogueLine } from "@/types/scenario";
import type { CharacterType, EmotionId } from "@/types/character";
import CharacterSprite from "@/components/character/CharacterSprite.vue";
import EmotionPickerDialog from "../EmotionPickerDialog.vue";
import { astToText } from "@/editor/logic/textUtils";
import { parseDialogueText } from "@/logic/textParser";

const CHARACTERS: CharacterType[] = ["fubuki", "miko", "narration"];

const props = defineProps<{
  line: DialogueLine;
  index: number;
}>();

const emit = defineEmits<{
  update: [index: number, updates: Partial<DialogueLine>];
  remove: [index: number];
}>();

// 表情ピッカーの参照
const emotionPickerRef = ref<{ showModal?: () => void }>();

const openEmotionPicker = (): void => {
  emotionPickerRef.value?.showModal?.();
};

const handleEmotionSelect = (emotionId: EmotionId): void => {
  emit("update", props.index, { emotion: emotionId });
};
</script>

<template>
  <div class="feedback-line">
    <div class="feedback-header">
      <select
        :value="line.character"
        class="form-input form-input-small"
        @change="
          (e) =>
            emit('update', index, {
              character: (e.target as HTMLSelectElement).value as CharacterType,
            })
        "
      >
        <option value="">キャラクター選択</option>
        <option
          v-for="char in CHARACTERS"
          :key="char"
          :value="char"
        >
          {{ char }}
        </option>
      </select>
      <!-- 表情選択ボタン -->
      <button
        type="button"
        class="emotion-selector-button"
        :title="`表情ID: ${line.emotion}`"
        @click="openEmotionPicker"
      >
        <CharacterSprite
          v-if="line.character"
          :character="line.character as CharacterType"
          :emotion-id="line.emotion"
          :width="32"
          :height="32"
        />
        <span
          v-else
          class="placeholder"
          >表情選択</span
        >
      </button>
      <div class="feedback-actions-buttons">
        <button
          type="button"
          class="btn-remove-small"
          @click.prevent="emit('remove', index)"
        >
          ✕
        </button>
      </div>
    </div>
    <textarea
      :value="astToText(line.text)"
      class="form-textarea"
      placeholder="テキスト"
      rows="2"
      @input="
        (e) =>
          emit('update', index, {
            text: parseDialogueText((e.target as HTMLTextAreaElement).value),
          })
      "
    />
    <!-- 表情ピッカーダイアログ -->
    <EmotionPickerDialog
      v-if="line.character"
      ref="emotionPickerRef"
      :character="line.character as CharacterType"
      @select="handleEmotionSelect"
    />
  </div>
</template>

<style scoped>
.feedback-line {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  padding: var(--size-6);
  background-color: white;
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.feedback-header {
  display: flex;
  gap: var(--size-2);
  align-items: center;
  flex-wrap: wrap;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
}

.form-group label {
  font-weight: 600;
  font-size: var(--size-12);
}

.form-input,
.form-textarea {
  padding: var(--size-2);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: var(--size-12);
  font-family: inherit;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: #4a90e2;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.05);
}

.form-input-small {
  flex: 1;
  min-width: 80px;
  padding: var(--size-2);
  font-size: var(--size-10);
}

.form-textarea {
  resize: vertical;
}

.emotion-selector-button {
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  background-color: var(--color-bg-gray);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--size-10);
}

.emotion-selector-button:hover {
  background-color: #f0f0f0;
}

.emotion-selector-button .placeholder {
  color: var(--color-text-secondary);
}

.feedback-actions-buttons {
  display: flex;
  gap: var(--size-2);
  margin-left: auto;
}

.btn-remove-small {
  padding: var(--size-2) var(--size-5);
  background-color: #ff6b6b;
  border: none;
  cursor: pointer;
  font-size: var(--size-10);
  border-radius: 3px;
  transition: opacity 0.2s;
}

.btn-remove-small:hover {
  opacity: 0.8;
}

.field-label {
  color: var(--color-fubuki-primary);
  font-weight: 600;
  font-size: 9px;
}
</style>
