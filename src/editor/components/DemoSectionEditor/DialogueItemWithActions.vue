<script setup lang="ts">
import type { DemoSection, DemoDialogue } from "@/types/scenario";
import type { CharacterType, EmotionId } from "@/types/character";
import { computed, ref, watch, useId } from "vue";
import CharacterSprite from "@/components/character/CharacterSprite.vue";
import EmotionPickerDialog from "../EmotionPickerDialog.vue";
import BoardActionsList from "./BoardActionsList.vue";
import { astToText } from "@/editor/logic/textUtils";
import {
  parseDialogueText,
  stringifyText,
  parseText,
} from "@/logic/textParser";
import { useEditorStore } from "@/editor/stores/editorStore";
import {
  countDisplayCharacters,
  countDisplayCharactersPerLine,
  DIALOGUE_MAX_LENGTH_NO_NEWLINE,
  DIALOGUE_MAX_LENGTH_PER_LINE,
  DIALOGUE_MAX_LINES,
} from "@/logic/scenarioFileHandler";

const CHARACTERS: CharacterType[] = ["fubuki", "miko", "narration"];

const emotionPickerRef = ref<{ showModal?: () => void } | null>(null);

const emit = defineEmits<{
  remove: [];
  "move-up": [];
  "move-down": [];
  "add-after": [];
  "split-here": [];
}>();

const props = defineProps<{
  dialogue: DemoDialogue;
  dialogueIndex: number;
  dialogueCount: number;
  sectionIndex: number;
  getCurrentSection: () => DemoSection | null;
  updateDialogue: (index: number, updates: Partial<DemoDialogue>) => void;
}>();

const editorStore = useEditorStore();

// 改行の有無を判定
const hasLineBreak = computed(() =>
  props.dialogue.text.some((n) => n.type === "lineBreak"),
);

// 文字数カウント情報
const charCountInfo = computed(() => {
  if (hasLineBreak.value) {
    const lineCounts = countDisplayCharactersPerLine(props.dialogue.text);
    return {
      type: "multiline" as const,
      lines: lineCounts,
      isOver:
        lineCounts.length > DIALOGUE_MAX_LINES ||
        lineCounts.some((c) => c > DIALOGUE_MAX_LENGTH_PER_LINE),
    };
  }
  const count = countDisplayCharacters(props.dialogue.text);
  return {
    type: "singleline" as const,
    count,
    isOver: count > DIALOGUE_MAX_LENGTH_NO_NEWLINE,
  };
});

// バリデーションエラー
const dialogueError = computed(() => {
  const errorPath = `sections[${props.sectionIndex}].dialogues[${props.dialogueIndex}].text`;
  return editorStore.validationErrors.find((e) => e.path === errorPath);
});

const dialogueText = ref<string>(astToText(props.dialogue.text));
const textareaId = useId();

const descriptionText = computed(() =>
  stringifyText(props.dialogue.description?.text || []),
);

const hasDescriptionText = computed(
  () => (props.dialogue.description?.text.length ?? 0) > 0,
);

const handleDescriptionChange = (e: Event): void => {
  const text = (e.target as HTMLTextAreaElement).value;
  const parsedText = parseText(text);
  // テキストがあれば clear フラグは不要
  if (parsedText.length > 0) {
    props.updateDialogue(props.dialogueIndex, {
      description: { text: parsedText },
    });
  } else {
    // テキストが空の場合、既存の clear フラグを維持
    props.updateDialogue(props.dialogueIndex, {
      description: {
        text: parsedText,
        clear: props.dialogue.description?.clear,
      },
    });
  }
};

const handleClearChange = (e: Event): void => {
  const { checked } = e.target as HTMLInputElement;
  props.updateDialogue(props.dialogueIndex, {
    description: {
      text: props.dialogue.description?.text || [],
      clear: checked || undefined,
    },
  });
};

watch(
  () => props.dialogue.text,
  (nextText) => {
    dialogueText.value = astToText(nextText);
  },
  { deep: true },
);

const canMoveUp = computed(() => props.dialogueIndex > 0);
const canMoveDown = computed(
  () => props.dialogueIndex < props.dialogueCount - 1,
);

// 分割可能条件: 最初のダイアログでなく、ダイアログが2つ以上ある
const canSplit = computed(
  () => props.dialogueIndex > 0 && props.dialogueCount > 1,
);

const openEmotionPicker = (): void => {
  const pickerRef = emotionPickerRef.value as {
    showModal?: () => void;
  };
  pickerRef?.showModal?.();
};

const handleEmotionSelect = (emotionId: EmotionId): void => {
  props.updateDialogue(props.dialogueIndex, { emotion: emotionId });
};

const handleCharacterChange = (character: CharacterType): void => {
  props.updateDialogue(props.dialogueIndex, { character });
};

const handleTextChange = (): void => {
  const parsed = parseDialogueText(dialogueText.value);
  props.updateDialogue(props.dialogueIndex, { text: parsed });
};

const handleMoveUp = (): void => {
  if (canMoveUp.value) {
    emit("move-up");
  }
};

const handleMoveDown = (): void => {
  if (canMoveDown.value) {
    emit("move-down");
  }
};

const handleRemove = (): void => {
  emit("remove");
};

const handleAddAfter = (): void => {
  emit("add-after");
};

const handleSplitHere = (): void => {
  if (canSplit.value) {
    emit("split-here");
  }
};
</script>

<template>
  <div class="dialogue-item-with-actions">
    <div class="dialogue-header">
      <div class="dialogue-id">
        <label>ダイアログID</label>
        <input
          :value="dialogue.id"
          class="readonly-input"
          readonly
          disabled
        />
      </div>
      <div class="dialogue-actions">
        <button
          v-if="canSplit"
          type="button"
          class="split-button"
          title="ここから新しいセクションに分割"
          @click="handleSplitHere"
        >
          ✂
        </button>
        <button
          type="button"
          class="move-button"
          :disabled="!canMoveUp"
          @click="handleMoveUp"
        >
          ▲
        </button>
        <button
          type="button"
          class="move-button"
          :disabled="!canMoveDown"
          @click="handleMoveDown"
        >
          ▼
        </button>
        <button
          type="button"
          class="remove-button"
          @click="handleRemove"
        >
          ✕
        </button>
      </div>
    </div>

    <div class="dialogue-section">
      <div class="dialogue-editor">
        <div class="dialogue-row">
          <div class="field field-character">
            <span>キャラクター</span>
            <div class="radio-group-vertical">
              <label
                v-for="char in CHARACTERS"
                :key="char"
                class="radio-label"
              >
                <input
                  type="radio"
                  :value="char"
                  :checked="dialogue.character === char"
                  @change="handleCharacterChange(char)"
                />
                {{ char }}
              </label>
            </div>
          </div>

          <label class="field field-emotion">
            <span>表情</span>
            <button
              type="button"
              class="emotion-selector-button"
              :title="`表情ID: ${dialogue.emotion}`"
              @click="openEmotionPicker"
            >
              <CharacterSprite
                :character="dialogue.character"
                :emotion-id="dialogue.emotion"
                class="character-preview"
                :width="32"
                :height="32"
              />
            </button>
            <EmotionPickerDialog
              ref="emotionPickerRef"
              :character="dialogue.character"
              @select="handleEmotionSelect"
            />
          </label>

          <div class="field field-text">
            <div class="field-header">
              <label :for="textareaId">テキスト</label>
              <span
                class="char-counter"
                :class="{ 'char-counter--over': charCountInfo.isOver }"
              >
                <template v-if="charCountInfo.type === 'singleline'">
                  {{ charCountInfo.count }}/{{ DIALOGUE_MAX_LENGTH_NO_NEWLINE }}
                </template>
                <template v-else>
                  {{ charCountInfo.lines.length }}行 ({{
                    charCountInfo.lines.join(", ")
                  }}) / 各{{ DIALOGUE_MAX_LENGTH_PER_LINE }}文字
                </template>
              </span>
            </div>
            <textarea
              :id="textareaId"
              v-model="dialogueText"
              placeholder="ダイアログテキストを入力"
              rows="3"
              :class="{ 'input-error': charCountInfo.isOver }"
              @change="handleTextChange"
            />
            <span
              v-if="dialogueError"
              class="inline-error"
            >
              {{ dialogueError.message }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="description-section">
      <label class="field">
        <span>説明テキスト</span>
        <textarea
          :value="descriptionText"
          placeholder="説明を入力（ルビ: {漢字|かんじ}, 強調: **太字**, リスト: - 項目, 改行: \\n）"
          rows="3"
          @change="handleDescriptionChange"
        />
      </label>
      <label
        v-if="!hasDescriptionText"
        class="field checkbox"
      >
        <input
          type="checkbox"
          :checked="dialogue.description?.clear === true"
          @change="handleClearChange"
        />
        <span>説明をクリア</span>
      </label>
    </div>

    <div class="board-actions-section">
      <BoardActionsList
        :dialogue-index="dialogueIndex"
        :board-actions="dialogue.boardActions"
        :get-current-section="getCurrentSection"
        :update-dialogue="updateDialogue"
      />
    </div>

    <div class="action-buttons">
      <button
        type="button"
        class="btn-add-after"
        @click="handleAddAfter"
      >
        + 直後に追加
      </button>
    </div>
  </div>
</template>

<style scoped>
.dialogue-item-with-actions {
  display: flex;
  flex-direction: column;
  gap: var(--size-10);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: var(--size-8);
  background: var(--color-bg-white);
}

.dialogue-header {
  display: flex;
  gap: var(--size-6);
  align-items: flex-end;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--size-6);
}

.dialogue-id {
  display: flex;
  gap: var(--size-2);
}

.dialogue-id label {
  font-weight: var(--font-weight-bold);
  font-size: var(--size-12);
}

.readonly-input {
  padding: var(--size-2) var(--size-4);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: var(--size-10);
  background: var(--color-bg-gray);
  color: var(--color-text-secondary);
}

.dialogue-actions {
  display: flex;
  gap: var(--size-2);
  align-items: center;
}

.move-button,
.remove-button,
.split-button {
  width: var(--size-20);
  height: var(--size-20);
  border-radius: 2px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  font-size: var(--size-12);
}

.split-button {
  border-color: var(--color-holo-blue);
  color: var(--color-holo-blue);
}

.split-button:hover {
  background: var(--color-holo-blue);
  color: white;
}

.move-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.remove-button {
  border-color: var(--color-border-heavy);
  color: var(--color-text-secondary);
}

.dialogue-section {
  display: flex;
  flex-direction: column;
  gap: var(--size-4);
}

.board-actions-section {
  border-top: 1px solid var(--color-border);
  padding-top: var(--size-4);
}

.dialogue-editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-4);
}

.dialogue-row {
  display: flex;
  gap: var(--size-4);
  align-items: flex-start;
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
}

.field label,
.field > span:first-child {
  font-weight: var(--font-weight-bold);
  font-size: var(--size-12);
}

.field-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--size-4);
}

.field-header label {
  font-weight: var(--font-weight-bold);
  font-size: var(--size-12);
}

.field-header .char-counter {
  margin-top: 0;
}

.field-text {
  flex: 2;
  min-width: var(--size-200);
}

.field-character {
  min-width: var(--size-100);
}

.field-emotion {
  max-width: var(--size-120);
  align-items: flex-start;
}

.radio-group-vertical {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
}

.radio-label {
  display: flex;
  align-items: center;
  gap: var(--size-4);
  font-size: var(--size-12);
  line-height: 1;
  cursor: pointer;
}

select,
textarea {
  padding: var(--size-3) var(--size-4);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-family: inherit;
  font-size: var(--size-12);
  color: var(--color-text-primary);
  background: var(--color-bg-white);
}

select:focus,
textarea:focus {
  outline: none;
  border-color: var(--color-holo-blue);
}

textarea {
  font-family: monospace;
  resize: vertical;
}

textarea.input-error {
  border-color: var(--color-error);
}

.input-footer {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--size-4);
  margin-top: var(--size-2);
}

.input-footer .inline-error {
  flex: 1;
}

.input-footer .char-counter {
  flex-shrink: 0;
}

.emotion-selector {
  display: flex;
  gap: var(--size-6);
  align-items: center;
  flex-wrap: wrap;
}

.character-preview {
  width: var(--size-32);
  height: var(--size-32);
}

.emotion-selector-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--size-40);
  height: var(--size-40);
  padding: var(--size-2);
  background: var(--color-bg-gray);
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.emotion-selector-button:hover {
  opacity: 0.9;
}

.description-section {
  border-top: 1px solid var(--color-border);
  padding-top: var(--size-12);
  margin-top: var(--size-12);
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
}

.description-section .field {
  display: flex;
  flex-direction: column;
  gap: var(--size-4);
}

.description-section .field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: var(--size-6);
}

.description-section textarea {
  min-width: 100%;
}

.action-buttons {
  display: flex;
  gap: var(--size-4);
  justify-content: flex-end;
  border-top: 1px solid var(--color-border);
  padding-top: var(--size-6);
}

.btn-add-after {
  padding: var(--size-3) var(--size-6);
  background-color: var(--color-holo-blue);
  color: white;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-11);
}

.btn-add-after:hover {
  opacity: 0.9;
}
</style>
