<script setup lang="ts">
import { ref } from "vue";
import type { DemoDialogue } from "@/types/scenario";
import type { CharacterType, EmotionId } from "@/types/character";
import CharacterSprite from "@/components/character/CharacterSprite.vue";
import EmotionPickerDialog from "../EmotionPickerDialog.vue";
import { astToText } from "@/editor/logic/textUtils";
import { parseDialogueText } from "@/logic/textParser";

const CHARACTERS: CharacterType[] = ["fubuki", "miko", "narration"];

// 表情ピッカーの参照
const emotionPickerRefs = ref<Record<number, unknown>>({});
// 表情ピッカーで選択中のダイアログインデックス
const selectedDialogueIndex = ref<number | null>(null);

const props = defineProps<{
  dialogues: DemoDialogue[];
}>();

const emit = defineEmits<{
  add: [];
  "add-after": [index: number];
  update: [index: number, updates: Partial<DemoDialogue>];
  remove: [index: number];
}>();

const openEmotionPicker = (index: number): void => {
  selectedDialogueIndex.value = index;
  const pickerRef = emotionPickerRefs.value[index] as {
    showModal?: () => void;
  };
  pickerRef?.showModal?.();
};

const handleEmotionSelect = (emotionId: EmotionId): void => {
  if (selectedDialogueIndex.value !== null) {
    emit("update", selectedDialogueIndex.value, { emotion: emotionId });
  }
};
</script>

<template>
  <details
    class="dialogues-section"
    open
  >
    <summary class="dialogues-header">
      <span>ダイアログ</span>
      <button
        type="button"
        class="btn-add-small"
        @click.stop.prevent="emit('add')"
      >
        + ダイアログを追加
      </button>
    </summary>

    <div
      v-if="dialogues.length === 0"
      class="empty-state"
    >
      ダイアログがありません
    </div>

    <div
      v-else
      class="dialogues-list"
    >
      <div
        v-for="(dialogue, index) in dialogues"
        :key="dialogue.id"
        class="dialogue-item"
      >
        <div class="dialogue-header">
          <input
            type="text"
            :value="dialogue.id"
            class="form-input form-input-small"
            placeholder="ID"
            readonly
            disabled
            title="ダイアログIDは自動採番されます（読み取り専用）"
          />
          <select
            :value="dialogue.character"
            class="form-input form-input-small"
            @change="
              (e) =>
                emit('update', index, {
                  character: (e.target as HTMLSelectElement)
                    .value as CharacterType,
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
            :title="`表情ID: ${dialogue.emotion}`"
            @click="openEmotionPicker(index)"
          >
            <CharacterSprite
              v-if="dialogue.character"
              :character="dialogue.character as CharacterType"
              :emotion-id="dialogue.emotion"
              :width="32"
              :height="32"
            />
            <span
              v-else
              class="placeholder"
              >表情選択</span>
          </button>
          <div class="dialogue-actions-buttons">
            <button
              type="button"
              class="btn-add-after"
              title="このダイアログの直後に新しいダイアログを追加"
              @click.prevent="emit('add-after', index)"
            >
              + 直後
            </button>
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
          :value="astToText(dialogue.text)"
          class="form-textarea"
          placeholder="台詞を入力"
          rows="3"
          @input="
            (e) =>
              emit('update', index, {
                text: parseDialogueText(
                  (e.target as HTMLTextAreaElement).value,
                ),
              })
          "
        />
        <!-- 表情ピッカーダイアログ -->
        <EmotionPickerDialog
          v-if="dialogue.character"
          :ref="
            (el) => {
              if (el) emotionPickerRefs[index] = el;
            }
          "
          :character="dialogue.character as CharacterType"
          @select="handleEmotionSelect"
        />
      </div>
      <button
        type="button"
        class="btn-add-small"
        @click.stop.prevent="emit('add')"
      >
        + ダイアログを追加
      </button>
    </div>
  </details>
</template>

<style scoped>
.dialogues-section {
  padding: var(--size-6);
  background-color: var(--color-bg-gray);
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.dialogues-section summary {
  cursor: pointer;
  font-weight: 600;
  font-size: var(--size-12);
  margin-bottom: var(--size-5);
  user-select: none;
}

.dialogues-section summary:hover {
  color: #4a90e2;
}

.dialogues-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialogues-header span {
  flex: 1;
}

.btn-add-small {
  padding: var(--size-2) var(--size-6);
  background-color: #4a90e2;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-10);
  transition: opacity 0.2s;
}

.btn-add-small:hover {
  opacity: 0.9;
}

.empty-state {
  padding: var(--size-8);
  text-align: center;
  color: var(--color-text-secondary);
  background-color: white;
  border-radius: 3px;
  font-size: var(--size-12);
}

.dialogues-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
  max-height: var(--size-500);
  overflow-y: auto;
}

.dialogue-item {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  padding: var(--size-6);
  background-color: white;
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.dialogue-header {
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

.dialogue-actions-buttons {
  display: flex;
  gap: var(--size-2);
  margin-left: auto;
}

.btn-move {
  padding: var(--size-2) var(--size-5);
  background-color: var(--color-bg-gray);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-10);
}

.btn-move:hover:not(:disabled) {
  background-color: #f0f0f0;
}

.btn-move:disabled {
  opacity: 0.3;
  cursor: not-allowed;
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

.btn-add-after {
  padding: var(--size-2) var(--size-5);
  background-color: var(--color-holo-blue);
  color: white;
  border: none;
  cursor: pointer;
  font-size: var(--size-9);
  border-radius: 3px;
  transition: opacity 0.2s;
}

.btn-add-after:hover {
  opacity: 0.9;
}

.field-label {
  color: var(--color-fubuki-primary);
  font-weight: 600;
  font-size: 9px;
}
</style>
