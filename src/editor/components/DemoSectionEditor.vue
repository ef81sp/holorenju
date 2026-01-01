<script setup lang="ts">
import { computed, type PropType } from "vue";
import { useEditorStore } from "@/editor/stores/editorStore";
import BoardVisualEditor from "./BoardVisualEditor.vue";
import type { DemoSection, DemoDialogue, BoardAction } from "@/types/scenario";
import type { Position } from "@/types/game";
import type { CharacterType, Emotion } from "@/types/character";

const editorStore = useEditorStore();

// キャラクター・感情の選択肢
const CHARACTERS: CharacterType[] = ["fubuki", "miko", "narration"];
const EMOTIONS: Emotion[] = [
  "normal",
  "happy",
  "thinking",
  "surprised",
  "explaining",
];

const props = defineProps({
  view: {
    type: String as PropType<"full" | "meta" | "content">,
    default: "full",
  },
});

const currentSection = computed<DemoSection | null>(() => {
  const section = editorStore.currentSection;
  return section && section.type === "demo" ? (section as DemoSection) : null;
});

// Methods
const updateBoard = (newBoard: string[]): void => {
  if (currentSection.value) {
    editorStore.updateCurrentSection({
      ...currentSection.value,
      initialBoard: newBoard,
    });
  }
};

const updateSectionTitle = (title: string): void => {
  if (currentSection.value) {
    editorStore.updateCurrentSection({
      ...currentSection.value,
      title,
    });
  }
};

const addDialogue = (): void => {
  if (currentSection.value) {
    const newDialogue: DemoDialogue = {
      id: `d-${Date.now()}`,
      character: "",
      text: "",
    };
    editorStore.updateCurrentSection({
      ...currentSection.value,
      dialogues: [...currentSection.value.dialogues, newDialogue],
    });
  }
};

const removeDialogue = (index: number): void => {
  if (currentSection.value) {
    const newDialogues = currentSection.value.dialogues.filter(
      (_, i) => i !== index,
    );
    editorStore.updateCurrentSection({
      ...currentSection.value,
      dialogues: newDialogues,
    });
  }
};

const updateDialogue = (index: number, updates: Partial<DemoDialogue>): void => {
  if (currentSection.value) {
    const newDialogues = [...currentSection.value.dialogues];
    newDialogues[index] = { ...newDialogues[index], ...updates };
    editorStore.updateCurrentSection({
      ...currentSection.value,
      dialogues: newDialogues,
    });
  }
};

const createBoardAction = (type: BoardAction["type"]): BoardAction => {
  switch (type) {
    case "place":
      return {
        type: "place",
        position: { row: 0, col: 0 },
        color: "black",
        highlight: false,
      };
    case "remove":
      return {
        type: "remove",
        position: { row: 0, col: 0 },
      };
    case "setBoard":
      return {
        type: "setBoard",
        board: Array(15).fill("e".repeat(15)),
      };
    case "mark":
      return {
        type: "mark",
        positions: [],
        markType: "circle",
      };
    case "line":
      return {
        type: "line",
        fromPosition: { row: 0, col: 0 },
        toPosition: { row: 0, col: 0 },
        action: "draw",
        style: "solid",
      };
    default:
      return {
        type: "place",
        position: { row: 0, col: 0 },
        color: "black",
      };
  }
};

const setBoardAction = (index: number, action?: BoardAction): void => {
  updateDialogue(index, { boardAction: action });
};

const changeBoardActionType = (index: number, type: BoardAction["type"]): void => {
  setBoardAction(index, createBoardAction(type));
};

const clearBoardAction = (index: number): void => {
  setBoardAction(index, undefined);
};

const updateBoardActionPosition = (
  index: number,
  key: "position" | "fromPosition" | "toPosition",
  field: "row" | "col",
  value: number,
): void => {
  const dialogue = currentSection.value?.dialogues[index];
  if (!dialogue?.boardAction) {
    return;
  }
  const nextValue = Math.max(0, Math.min(14, value));
  const action = dialogue.boardAction;

  if ((action.type === "place" || action.type === "remove") && key === "position") {
    const updatedPos: Position = { ...action.position, [field]: nextValue };
    setBoardAction(index, { ...action, position: updatedPos });
    return;
  }

  if (action.type === "line") {
    if (key === "fromPosition") {
      const updatedPos: Position = { ...action.fromPosition, [field]: nextValue };
      setBoardAction(index, { ...action, fromPosition: updatedPos });
      return;
    }
    if (key === "toPosition") {
      const updatedPos: Position = { ...action.toPosition, [field]: nextValue };
      setBoardAction(index, { ...action, toPosition: updatedPos });
    }
  }
};

const updateBoardActionColor = (index: number, color: "black" | "white"): void => {
  const dialogue = currentSection.value?.dialogues[index];
  if (!dialogue?.boardAction || dialogue.boardAction.type !== "place") {
    return;
  }
  setBoardAction(index, { ...dialogue.boardAction, color });
};

const updateBoardActionHighlight = (index: number, highlight: boolean): void => {
  const dialogue = currentSection.value?.dialogues[index];
  if (!dialogue?.boardAction || dialogue.boardAction.type !== "place") {
    return;
  }
  setBoardAction(index, { ...dialogue.boardAction, highlight });
};

const updateBoardActionBoard = (index: number, text: string): void => {
  const dialogue = currentSection.value?.dialogues[index];
  if (!dialogue?.boardAction || dialogue.boardAction.type !== "setBoard") {
    return;
  }
  const lines = text.split("\n").map((line) => line.trim());
  setBoardAction(index, { ...dialogue.boardAction, board: lines });
};

const addBoardActionMarkPosition = (index: number): void => {
  const dialogue = currentSection.value?.dialogues[index];
  if (!dialogue?.boardAction || dialogue.boardAction.type !== "mark") {
    return;
  }
  const positions = [...dialogue.boardAction.positions, { row: 0, col: 0 }];
  setBoardAction(index, { ...dialogue.boardAction, positions });
};

const updateBoardActionMarkPosition = (
  index: number,
  posIndex: number,
  field: "row" | "col",
  value: number,
): void => {
  const dialogue = currentSection.value?.dialogues[index];
  if (!dialogue?.boardAction || dialogue.boardAction.type !== "mark") {
    return;
  }
  const positions = [...dialogue.boardAction.positions];
  const nextValue = Math.max(0, Math.min(14, value));
  positions[posIndex] = {
    ...positions[posIndex],
    [field]: nextValue,
  } as Position;
  setBoardAction(index, { ...dialogue.boardAction, positions });
};

const removeBoardActionMarkPosition = (index: number, posIndex: number): void => {
  const dialogue = currentSection.value?.dialogues[index];
  if (!dialogue?.boardAction || dialogue.boardAction.type !== "mark") {
    return;
  }
  const positions = dialogue.boardAction.positions.filter(
    (_, i) => i !== posIndex,
  );
  setBoardAction(index, { ...dialogue.boardAction, positions });
};

const updateBoardActionMarkMeta = (
  index: number,
  updates: Partial<Extract<BoardAction, { type: "mark" }>>,
): void => {
  const dialogue = currentSection.value?.dialogues[index];
  if (!dialogue?.boardAction || dialogue.boardAction.type !== "mark") {
    return;
  }
  setBoardAction(index, { ...dialogue.boardAction, ...updates });
};

const updateBoardActionLine = (
  index: number,
  updates: Partial<Extract<BoardAction, { type: "line" }>>,
): void => {
  const dialogue = currentSection.value?.dialogues[index];
  if (!dialogue?.boardAction || dialogue.boardAction.type !== "line") {
    return;
  }
  setBoardAction(index, { ...dialogue.boardAction, ...updates });
};
</script>

<template>
  <div
    v-if="currentSection"
    class="demo-section-editor"
  >
    <div class="detail-grid">
      <div
        v-if="props.view !== 'content'"
        class="detail-left"
      >
        <!-- セクション情報（タイトルのみ左列） -->
        <div class="form-group">
          <label for="demo-title">セクションタイトル</label>
          <input
            id="demo-title"
            type="text"
            :value="currentSection.title"
            class="form-input"
            @input="
              (e) => updateSectionTitle((e.target as HTMLInputElement).value)
            "
          >
        </div>
      </div>

      <div
        v-if="props.view !== 'meta'"
        class="detail-right"
      >
        <!-- 盤面エディタ -->
        <details
          class="board-editor-wrapper"
          open
        >
          <summary>初期盤面</summary>
          <BoardVisualEditor
            :board="currentSection.initialBoard"
            @update:board="updateBoard"
          />
        </details>

        <!-- ダイアログリスト -->
        <details
          class="dialogues-section"
          open
        >
          <summary class="dialogues-header">
            <span>ダイアログ</span>
            <button
              type="button"
              class="btn-add-small"
              @click.stop.prevent="addDialogue"
            >
              + ダイアログを追加
            </button>
          </summary>

          <div
            v-if="currentSection.dialogues.length === 0"
            class="empty-state"
          >
            ダイアログがありません
          </div>

          <div
            v-else
            class="dialogues-list"
          >
            <div
              v-for="(dialogue, index) in currentSection.dialogues"
              :key="dialogue.id"
              class="dialogue-item"
            >
              <div class="dialogue-header">
                <input
                  type="text"
                  :value="dialogue.id"
                  class="form-input form-input-small"
                  placeholder="ID"
                  @input="
                    (e) =>
                      updateDialogue(index, {
                        id: (e.target as HTMLInputElement).value,
                      })
                  "
                >
                <select
                  :value="dialogue.character"
                  class="form-input form-input-small"
                  @change="
                    (e) =>
                      updateDialogue(index, {
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
                <select
                  :value="dialogue.emotion || ''"
                  class="form-input form-input-small"
                  @change="
                    (e) =>
                      updateDialogue(index, {
                        emotion: (e.target as HTMLSelectElement)
                          .value as Emotion,
                      })
                  "
                >
                  <option value="">感情選択</option>
                  <option
                    v-for="emotion in EMOTIONS"
                    :key="emotion"
                    :value="emotion"
                  >
                    {{ emotion }}
                  </option>
                </select>
                <button
                  type="button"
                  class="btn-remove-small"
                  @click.prevent="removeDialogue(index)"
                >
                  ✕
                </button>
              </div>
              <textarea
                :value="dialogue.text"
                class="form-textarea"
                placeholder="台詞を入力"
                rows="3"
                @input="
                  (e) =>
                    updateDialogue(index, {
                      text: (e.target as HTMLTextAreaElement).value,
                    })
                "
              />
              <div class="board-action-block">
                <div class="board-action-header">
                  <span>Board Action</span>
                  <button
                    v-if="dialogue.boardAction"
                    type="button"
                    class="btn-inline"
                    @click.prevent="clearBoardAction(index)"
                  >
                    クリア
                  </button>
                  <button
                    v-else
                    type="button"
                    class="btn-add-small btn-inline"
                    @click.prevent="changeBoardActionType(index, 'place')"
                  >
                    + 追加
                  </button>
                </div>

                <div
                  v-if="dialogue.boardAction"
                  class="board-action-body"
                >
                  <div class="field-row">
                    <label>タイプ</label>
                    <select
                      :value="dialogue.boardAction.type"
                      class="form-input form-input-small"
                      @change="
                        (e) =>
                          changeBoardActionType(
                            index,
                            (e.target as HTMLSelectElement)
                              .value as BoardAction['type'],
                          )
                      "
                    >
                      <option value="place">place</option>
                      <option value="remove">remove</option>
                      <option value="setBoard">setBoard</option>
                      <option value="mark">mark</option>
                      <option value="line">line</option>
                    </select>
                  </div>

                  <div
                    v-if="dialogue.boardAction.type === 'place'"
                    class="board-action-section"
                  >
                    <div class="field-row">
                      <label>行</label>
                      <input
                        type="number"
                        min="0"
                        max="14"
                        :value="dialogue.boardAction.position.row"
                        class="form-input form-input-small"
                        @input="
                          (e) =>
                            updateBoardActionPosition(
                              index,
                              'position',
                              'row',
                              Number((e.target as HTMLInputElement).value),
                            )
                        "
                      >
                      <label>列</label>
                      <input
                        type="number"
                        min="0"
                        max="14"
                        :value="dialogue.boardAction.position.col"
                        class="form-input form-input-small"
                        @input="
                          (e) =>
                            updateBoardActionPosition(
                              index,
                              'position',
                              'col',
                              Number((e.target as HTMLInputElement).value),
                            )
                        "
                      >
                    </div>
                    <div class="field-row">
                      <label>色</label>
                      <select
                        :value="dialogue.boardAction.color"
                        class="form-input form-input-small"
                        @change="
                          (e) =>
                            updateBoardActionColor(
                              index,
                              (e.target as HTMLSelectElement).value as
                                | 'black'
                                | 'white',
                            )
                        "
                      >
                        <option value="black">黒</option>
                        <option value="white">白</option>
                      </select>
                      <label class="checkbox-inline">
                        <input
                          type="checkbox"
                          :checked="dialogue.boardAction.highlight"
                          @change="
                            (e) =>
                              updateBoardActionHighlight(
                                index,
                                (e.target as HTMLInputElement).checked,
                              )
                          "
                        >
                        ハイライト
                      </label>
                    </div>
                  </div>

                  <div
                    v-else-if="dialogue.boardAction.type === 'remove'"
                    class="board-action-section"
                  >
                    <div class="field-row">
                      <label>行</label>
                      <input
                        type="number"
                        min="0"
                        max="14"
                        :value="dialogue.boardAction.position.row"
                        class="form-input form-input-small"
                        @input="
                          (e) =>
                            updateBoardActionPosition(
                              index,
                              'position',
                              'row',
                              Number((e.target as HTMLInputElement).value),
                            )
                        "
                      >
                      <label>列</label>
                      <input
                        type="number"
                        min="0"
                        max="14"
                        :value="dialogue.boardAction.position.col"
                        class="form-input form-input-small"
                        @input="
                          (e) =>
                            updateBoardActionPosition(
                              index,
                              'position',
                              'col',
                              Number((e.target as HTMLInputElement).value),
                            )
                        "
                      >
                    </div>
                  </div>

                  <div
                    v-else-if="dialogue.boardAction.type === 'setBoard'"
                    class="board-action-section"
                  >
                    <label>盤面データ (15行)</label>
                    <textarea
                      :value="dialogue.boardAction.board.join('\n')"
                      class="form-textarea"
                      rows="6"
                      placeholder="eで空白、x=黒、o=白"
                      @input="
                        (e) =>
                          updateBoardActionBoard(
                            index,
                            (e.target as HTMLTextAreaElement).value,
                          )
                      "
                    />
                  </div>

                  <div
                    v-else-if="dialogue.boardAction.type === 'mark'"
                    class="board-action-section"
                  >
                    <div class="field-row">
                      <label>マーク</label>
                      <select
                        :value="dialogue.boardAction.markType"
                        class="form-input form-input-small"
                        @change="
                          (e) =>
                            updateBoardActionMarkMeta(index, {
                              markType: (e.target as HTMLSelectElement)
                                .value as 'circle' | 'cross' | 'arrow',
                            })
                        "
                      >
                        <option value="circle">Circle</option>
                        <option value="cross">Cross</option>
                        <option value="arrow">Arrow</option>
                      </select>
                      <input
                        type="text"
                        :value="dialogue.boardAction.label || ''"
                        class="form-input form-input-small"
                        placeholder="ラベル (任意)"
                        @input="
                          (e) =>
                            updateBoardActionMarkMeta(index, {
                              label: (e.target as HTMLInputElement).value,
                            })
                        "
                      >
                    </div>
                    <div class="positions-list">
                      <div
                        v-for="(pos, posIndex) in dialogue.boardAction
                          .positions"
                        :key="`mark-${posIndex}`"
                        class="position-row"
                      >
                        <label>行</label>
                        <input
                          type="number"
                          min="0"
                          max="14"
                          :value="pos.row"
                          class="form-input form-input-small"
                          @input="
                            (e) =>
                              updateBoardActionMarkPosition(
                                index,
                                posIndex,
                                'row',
                                Number((e.target as HTMLInputElement).value),
                              )
                          "
                        >
                        <label>列</label>
                        <input
                          type="number"
                          min="0"
                          max="14"
                          :value="pos.col"
                          class="form-input form-input-small"
                          @input="
                            (e) =>
                              updateBoardActionMarkPosition(
                                index,
                                posIndex,
                                'col',
                                Number((e.target as HTMLInputElement).value),
                              )
                          "
                        >
                        <button
                          type="button"
                          class="btn-inline"
                          @click.prevent="
                            removeBoardActionMarkPosition(index, posIndex)
                          "
                        >
                          削除
                        </button>
                      </div>
                      <button
                        type="button"
                        class="btn-add-small btn-inline"
                        @click.prevent="addBoardActionMarkPosition(index)"
                      >
                        + 座標追加
                      </button>
                    </div>
                  </div>

                  <div
                    v-else
                    class="board-action-section"
                  >
                    <div class="positions-list">
                      <div class="position-row">
                        <label>開始 行/列</label>
                        <input
                          type="number"
                          min="0"
                          max="14"
                          :value="dialogue.boardAction.fromPosition.row"
                          class="form-input form-input-small"
                          @input="
                            (e) =>
                              updateBoardActionPosition(
                                index,
                                'fromPosition',
                                'row',
                                Number((e.target as HTMLInputElement).value),
                              )
                          "
                        >
                        <input
                          type="number"
                          min="0"
                          max="14"
                          :value="dialogue.boardAction.fromPosition.col"
                          class="form-input form-input-small"
                          @input="
                            (e) =>
                              updateBoardActionPosition(
                                index,
                                'fromPosition',
                                'col',
                                Number((e.target as HTMLInputElement).value),
                              )
                          "
                        >
                      </div>
                      <div class="position-row">
                        <label>終了 行/列</label>
                        <input
                          type="number"
                          min="0"
                          max="14"
                          :value="dialogue.boardAction.toPosition.row"
                          class="form-input form-input-small"
                          @input="
                            (e) =>
                              updateBoardActionPosition(
                                index,
                                'toPosition',
                                'row',
                                Number((e.target as HTMLInputElement).value),
                              )
                          "
                        >
                        <input
                          type="number"
                          min="0"
                          max="14"
                          :value="dialogue.boardAction.toPosition.col"
                          class="form-input form-input-small"
                          @input="
                            (e) =>
                              updateBoardActionPosition(
                                index,
                                'toPosition',
                                'col',
                                Number((e.target as HTMLInputElement).value),
                              )
                          "
                        >
                      </div>
                    </div>
                    <div class="field-row">
                      <label>アクション</label>
                      <select
                        :value="dialogue.boardAction.action"
                        class="form-input form-input-small"
                        @change="
                          (e) =>
                            updateBoardActionLine(index, {
                              action: (e.target as HTMLSelectElement).value as
                                | 'draw'
                                | 'remove',
                            })
                        "
                      >
                        <option value="draw">draw</option>
                        <option value="remove">remove</option>
                      </select>
                      <label>線の種類</label>
                      <select
                        :value="dialogue.boardAction.style || 'solid'"
                        class="form-input form-input-small"
                        @change="
                          (e) =>
                            updateBoardActionLine(index, {
                              style: (e.target as HTMLSelectElement).value as
                                | 'solid'
                                | 'dashed',
                            })
                        "
                      >
                        <option value="solid">solid</option>
                        <option value="dashed">dashed</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.demo-section-editor {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.8);
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: calc(var(--size-unit) * 0.8);
  align-items: start;
}

.detail-left,
.detail-right {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.6);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.3);
}

.form-group label {
  font-weight: 600;
  font-size: calc(var(--size-unit) * 1.1);
}

.form-input {
  padding: calc(var(--size-unit) * 0.3);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: calc(var(--size-unit) * 1.1);
  font-family: inherit;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.05);
}

.board-editor-wrapper {
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: calc(var(--size-unit) * 0.6);
}

.board-editor-wrapper summary {
  cursor: pointer;
  font-weight: 600;
  font-size: calc(var(--size-unit) * 1.1);
  margin-bottom: calc(var(--size-unit) * 0.5);
  user-select: none;
}

.board-editor-wrapper summary:hover {
  color: var(--color-primary);
}

.dialogues-section {
  padding: calc(var(--size-unit) * 0.6);
  background-color: var(--color-background-soft);
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.dialogues-section summary {
  cursor: pointer;
  user-select: none;
}

.dialogues-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: calc(var(--size-unit) * 1.1);
  margin-bottom: calc(var(--size-unit) * 0.5);
}

.dialogues-header span {
  flex: 1;
}

.btn-add-small {
  padding: calc(var(--size-unit) * 0.3) calc(var(--size-unit) * 0.6);
  background-color: var(--color-primary);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: calc(var(--size-unit) * 1);
  transition: opacity 0.2s;
}

.btn-add-small:hover {
  opacity: 0.9;
}

.empty-state {
  padding: calc(var(--size-unit) * 0.8);
  text-align: center;
  color: var(--color-text-secondary);
  background-color: white;
  border-radius: 3px;
  font-size: calc(var(--size-unit) * 1.1);
}

.dialogues-list {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.6);
}

.dialogue-item {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.4);
  padding: calc(var(--size-unit) * 0.6);
  background-color: white;
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.dialogue-header {
  display: flex;
  gap: calc(var(--size-unit) * 0.3);
  align-items: flex-start;
  flex-wrap: wrap;
}

.form-input-small {
  flex: 1;
  min-width: calc(var(--size-unit) * 10);
  padding: calc(var(--size-unit) * 0.3);
  font-size: calc(var(--size-unit) * 1);
}

.btn-remove-small {
  padding: calc(var(--size-unit) * 0.3) calc(var(--size-unit) * 0.5);
  background-color: #ff6b6b;
  border: none;
  cursor: pointer;
  font-size: calc(var(--size-unit) * 1);
  border-radius: 3px;
  transition: opacity 0.2s;
}

.btn-remove-small:hover {
  opacity: 0.8;
}

.form-textarea {
  padding: calc(var(--size-unit) * 0.3);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: calc(var(--size-unit) * 1);
  font-family: inherit;
  resize: vertical;
}

.form-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.dialogue-hint {
  color: var(--color-text-secondary);
  font-style: italic;
  font-size: calc(var(--size-unit) * 1);
}

.board-action-block {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.4);
  padding: calc(var(--size-unit) * 0.5);
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.board-action-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.board-action-body {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.4);
}

.board-action-section {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.4);
}

.field-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: calc(var(--size-unit) * 0.4);
}

.positions-list {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.3);
}

.position-row {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--size-unit) * 0.3);
  align-items: center;
}

.btn-inline {
  padding: calc(var(--size-unit) * 0.3) calc(var(--size-unit) * 0.6);
  border: 1px solid var(--color-border);
  background-color: white;
  border-radius: 3px;
  cursor: pointer;
  font-size: calc(var(--size-unit) * 1);
}

.btn-inline:hover {
  background-color: var(--color-background-soft);
}

.checkbox-inline {
  display: flex;
  gap: calc(var(--size-unit) * 0.3);
  align-items: center;
}
</style>
