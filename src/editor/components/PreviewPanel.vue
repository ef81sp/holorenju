<script setup lang="ts">
import { computed } from "vue";
import { useEditorStore } from "@/editor/stores/editorStore";
import RenjuBoard from "@/components/game/RenjuBoard/RenjuBoard.vue";
import CharacterSprite from "@/components/character/CharacterSprite.vue";
import DialogText from "@/components/common/DialogText.vue";
import RichText from "@/components/common/RichText.vue";
import type { DemoSection, QuestionSection } from "@/types/scenario";
import type { CharacterType, EmotionId } from "@/types/character";
import { isMarkMatching, type Mark, type Line } from "@/stores/boardStore";
import { assertNever } from "@/utils/assertNever";
import { getSectionDisplayTitle } from "@/utils/sectionUtils";
import {
  stringArrayToBoardState,
  applyBoardAction,
} from "@/editor/logic/boardCalculator";

const editorStore = useEditorStore();
const dialoguePageIndex = computed(() => editorStore.previewDialogueIndex);

const previewContent = computed(() => {
  const section = editorStore.currentSection;
  if (!section) {
    return null;
  }

  if (section.type === "demo") {
    const demoSection = section as DemoSection;
    return {
      type: "demo" as const,
      initialBoard: demoSection.initialBoard,
      dialogueCount: demoSection.dialogues.length,
      dialogues: demoSection.dialogues,
      firstDialogue: demoSection.dialogues[0],
    };
  }
  const questionSection = section as QuestionSection;
  return {
    type: "question" as const,
    board: questionSection.initialBoard,
    description: questionSection.description,
    conditionCount: questionSection.successConditions.length,
  };
});

// ダイアログページング関連
const currentDialogue = computed(() => {
  if (!previewContent.value || previewContent.value.type !== "demo") {
    return null;
  }
  const { dialogues } = previewContent.value;
  if (dialogues.length === 0) {
    return null;
  }
  return dialogues[dialoguePageIndex.value];
});

const dialoguePaginationInfo = computed(() => {
  if (!previewContent.value || previewContent.value.type !== "demo") {
    return null;
  }
  const total = previewContent.value.dialogues.length;
  return {
    current: dialoguePageIndex.value + 1,
    total,
  };
});

const goPreviousDialogue = (): void => {
  if (dialoguePageIndex.value > 0) {
    editorStore.setPreviewDialogueIndex(dialoguePageIndex.value - 1);
  }
};

const goNextDialogue = (): void => {
  if (!previewContent.value || previewContent.value.type !== "demo") {
    return;
  }
  if (dialoguePageIndex.value < previewContent.value.dialogues.length - 1) {
    editorStore.setPreviewDialogueIndex(dialoguePageIndex.value + 1);
  }
};

// 現在のダイアログまで操作を適用した盤面を計算
const currentBoard = computed(() => {
  if (!previewContent.value) {
    return null;
  }

  if (previewContent.value.type === "question") {
    return stringArrayToBoardState(previewContent.value.board);
  }

  const { initialBoard, dialogues } = previewContent.value;
  let board = stringArrayToBoardState(initialBoard);

  // 現在のダイアログインデックスまでのアクションを適用（現在のダイアログを含む）
  for (let i = 0; i <= dialoguePageIndex.value; i++) {
    const dialogue = dialogues[i];
    if (!dialogue) {
      break;
    }
    // BoardActions 配列をループして各アクションを順次適用
    for (const action of dialogue.boardActions) {
      board = applyBoardAction(action, board);
    }
  }

  return board;
});

// マーク配列から一致するマークを削除
const removeMatchingMark = (
  marks: Mark[],
  target: {
    positions: { row: number; col: number }[];
    markType: Mark["markType"];
  },
): void => {
  const removeIndex = marks.findIndex((m) => isMarkMatching(m, target));
  if (removeIndex >= 0) {
    marks.splice(removeIndex, 1);
  }
};

// 現在のダイアログまでのmark/lineアクションを収集
const currentMarks = computed<Mark[]>(() => {
  if (!previewContent.value || previewContent.value.type !== "demo") {
    return [];
  }

  const marks: Mark[] = [];
  const { dialogues } = previewContent.value;
  let markCounter = 0;

  for (let i = 0; i <= dialoguePageIndex.value; i++) {
    const dialogue = dialogues[i];
    if (!dialogue) {
      break;
    }
    for (const action of dialogue.boardActions) {
      switch (action.type) {
        case "resetAll":
        case "resetMarkLine":
          marks.length = 0;
          markCounter = 0;
          break;
        case "mark":
          if (action.action === "remove") {
            removeMatchingMark(marks, {
              positions: action.positions,
              markType: action.markType,
            });
          } else {
            // draw または undefined（デフォルト）
            marks.push({
              id: `preview-mark-${markCounter++}`,
              positions: action.positions,
              markType: action.markType,
              label: action.label,
              placedAtDialogueIndex: i,
            });
          }
          break;
        case "setBoard":
          marks.length = 0;
          markCounter = 0;
          break;
        case "place":
        case "remove":
        case "line":
          // マーク以外のアクションは無視
          break;
        default:
          assertNever(action);
      }
    }
  }

  return marks;
});

const currentLines = computed<Line[]>(() => {
  if (!previewContent.value || previewContent.value.type !== "demo") {
    return [];
  }

  const lines: Line[] = [];
  const { dialogues } = previewContent.value;
  let lineCounter = 0;

  for (let i = 0; i <= dialoguePageIndex.value; i++) {
    const dialogue = dialogues[i];
    if (!dialogue) {
      break;
    }
    for (const action of dialogue.boardActions) {
      switch (action.type) {
        case "resetAll":
        case "resetMarkLine":
          lines.length = 0;
          lineCounter = 0;
          break;
        case "line":
          if (action.action === "draw") {
            lines.push({
              id: `preview-line-${lineCounter++}`,
              fromPosition: action.fromPosition,
              toPosition: action.toPosition,
              style: action.style ?? "solid",
              placedAtDialogueIndex: i,
            });
          }
          // action === "remove" の場合は現状サポートなし
          break;
        case "place":
        case "remove":
        case "setBoard":
        case "mark":
          // ライン以外のアクションは無視
          break;
        default:
          assertNever(action);
      }
    }
  }

  return lines;
});
</script>

<template>
  <div class="preview-panel">
    <h3>プレビュー</h3>

    <div
      v-if="!previewContent"
      class="preview-empty"
    >
      セクションを選択するとプレビューが表示されます
    </div>

    <div
      v-else
      class="preview-content"
    >
      <div
        v-if="previewContent.type === 'demo'"
        class="preview-demo"
      >
        <h4>{{ editorStore.currentSection?.title }}</h4>
        <div class="preview-info">
          <div class="dialogue-header">
            <p>
              <strong>ダイアログ数:</strong>
              {{ previewContent.dialogueCount }}
            </p>
            <div
              v-if="previewContent.dialogueCount > 1"
              class="dialogue-controls"
            >
              <button
                class="dialogue-btn"
                :disabled="dialoguePageIndex === 0"
                @click="goPreviousDialogue"
              >
                ◀
              </button>
              <span class="dialogue-position">
                {{ dialoguePaginationInfo?.current }}/{{
                  dialoguePaginationInfo?.total
                }}
              </span>
              <button
                class="dialogue-btn"
                :disabled="
                  dialoguePageIndex === previewContent.dialogueCount - 1
                "
                @click="goNextDialogue"
              >
                ▶
              </button>
            </div>
          </div>
          <div
            v-if="previewContent.dialogueCount > 0"
            class="dialogue-display"
          >
            <div
              v-if="currentDialogue"
              class="dialogue-item"
            >
              <div class="dialogue-avatar">
                <CharacterSprite
                  :character="currentDialogue.character as CharacterType"
                  :emotion-id="(currentDialogue.emotion as EmotionId) || 0"
                />
              </div>
              <div class="dialogue-text-area">
                <span class="character-name">
                  {{ currentDialogue.character }}
                </span>
                <span class="dialogue-content">
                  <DialogText :nodes="currentDialogue.text" />
                </span>
              </div>
            </div>
          </div>
          <p
            v-if="previewContent.dialogueCount === 0"
            class="no-dialogue"
          >
            台詞なし
          </p>
        </div>
      </div>

      <div
        v-else
        class="preview-question"
      >
        <h4>
          {{
            editorStore.selectedSectionIndex !== null
              ? getSectionDisplayTitle(
                  editorStore.scenario.sections,
                  editorStore.selectedSectionIndex,
                )
              : ""
          }}
        </h4>
        <div class="preview-info">
          <p><strong>説明:</strong></p>
          <div class="description-preview">
            <RichText
              v-if="
                previewContent.description &&
                previewContent.description.length > 0
              "
              :nodes="previewContent.description"
            />
            <p
              v-else
              style="margin: 0"
            >
              (説明なし)
            </p>
          </div>
          <p>
            <strong>成功条件数:</strong>
            {{ previewContent.conditionCount }}
          </p>
        </div>
      </div>

      <div class="preview-board">
        <h5 v-if="previewContent.type === 'demo'">
          盤面 (ステップ {{ dialoguePaginationInfo?.current || 1 }})
        </h5>
        <h5 v-else>初期盤面</h5>
        <div class="board-container">
          <RenjuBoard
            v-if="currentBoard"
            :board-state="currentBoard"
            :disabled="true"
            :stage-size="300"
            :marks="currentMarks"
            :lines="currentLines"
            :dialogue-index="dialoguePageIndex"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-panel {
  padding: var(--size-6);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.preview-panel h3 {
  margin-top: 0;
  margin-bottom: var(--size-5);
  font-size: var(--size-12);
  border-bottom: 2px solid #4a90e2;
  padding-bottom: var(--size-2);
}

.preview-empty {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary);
  background-color: var(--color-bg-gray);
  border-radius: 4px;
  border: 1px dashed var(--color-border);
}

.preview-content {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}

.preview-demo,
.preview-question {
  padding: var(--size-6);
  background-color: var(--color-bg-gray);
  border-radius: 4px;
  border-left: 4px solid #4a90e2;
}

.preview-demo h4,
.preview-question h4 {
  margin-top: 0;
  margin-bottom: var(--size-5);
  font-size: var(--size-12);
}

.preview-info {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
  font-size: var(--size-10);
}

.preview-info p {
  margin: 0;
  line-height: 1.5;
}

.dialogue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.dialogue-header p {
  margin: 0;
  flex-shrink: 0;
}

.dialogue-display {
  padding: 0.5rem;
  background-color: white;
  border-radius: 3px;
  border-left: 3px solid #4caf50;
  margin-bottom: 0.5rem;
}

.dialogue-item {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.dialogue-avatar {
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
  background-color: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--size-56);
}

.dialogue-text-area {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.character-name {
  font-weight: 500;
  color: var(--color-text);
  font-size: 0.95rem;
}

.dialogue-content {
  color: var(--color-text-secondary, #555);
  line-height: 1.4;
  font-size: 0.9rem;
}

.dialogue-controls {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.dialogue-position {
  font-size: 0.75rem;
  min-width: 2.5rem;
  text-align: center;
  color: var(--color-text-secondary);
}

.dialogue-btn {
  padding: 0.3rem 0.5rem;
  font-size: 0.75rem;
  background-color: #4a90e2;
  color: var(--color-text);
  border: 1px solid #4a90e2;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
}

.dialogue-btn:hover:not(:disabled) {
  background-color: var(--color-bg-gray);
}

.dialogue-btn:disabled {
  background-color: var(--color-bg-gray);
  border-color: var(--color-border);
  color: var(--color-text-secondary);
  cursor: not-allowed;
  opacity: 0.5;
}

.no-dialogue {
  color: var(--color-text-secondary, #999);
  font-style: italic;
}

.dialogue-preview {
  display: block;
  padding: 0.5rem;
  background-color: white;
  border-radius: 3px;
  border-left: 3px solid #4caf50;
  margin-top: 0.25rem;
  font-style: italic;
}

.description-preview {
  padding: 0.5rem;
  background-color: white;
  border-radius: 3px;
  border-left: 3px solid #2196f3;
  font-size: 0.85rem;
  line-height: 1.4;
  margin-bottom: 0.5rem;
}

.preview-board {
  padding: 1rem;
  background-color: var(--color-bg-gray);
  border-radius: 4px;
}

.preview-board h5 {
  margin-top: 0;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.board-container {
  display: flex;
  justify-content: center;
  padding: 0.5rem;
  background-color: white;
  border-radius: 3px;
  border: 1px solid var(--color-border);
}
</style>
