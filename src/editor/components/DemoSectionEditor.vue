<script setup lang="ts">
import { computed, ref, type PropType } from "vue";
import { useEditorStore } from "@/editor/stores/editorStore";
import BoardVisualEditor from "./BoardVisualEditor.vue";
import EmotionPickerDialog from "./EmotionPickerDialog.vue";
import CharacterSprite from "@/components/character/CharacterSprite.vue";
import type { DemoSection, DemoDialogue, BoardAction } from "@/types/scenario";
import type { Position } from "@/types/game";
import type { CharacterType, EmotionId } from "@/types/character";
import type { TextNode } from "@/types/text";
import { generateDialogueId } from "@/logic/scenarioFileHandler";
import { parseDialogueText } from "@/logic/textParser";
import { astToText } from "@/editor/logic/textUtils";

const editorStore = useEditorStore();

// キャラクターの選択肢
const CHARACTERS: CharacterType[] = ["fubuki", "miko", "narration"];

// 表情ピッカーの参照
const emotionPickerRefs = ref<Record<number, unknown>>({});

// 表情ピッカーで選択中のダイアログインデックス
const selectedDialogueIndex = ref<number | null>(null);

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
    const newDialogues = [...currentSection.value.dialogues];
    const newDialogue: DemoDialogue = {
      id: generateDialogueId(newDialogues),
      character: "fubuki",
      text: [],
      emotion: 0,
      boardActions: [],
    };
    newDialogues.push(newDialogue);
    editorStore.updateCurrentSection({
      ...currentSection.value,
      dialogues: newDialogues,
    });
  }
};

const removeDialogue = (index: number): void => {
  if (currentSection.value) {
    const newDialogues = currentSection.value.dialogues.filter(
      (_, i) => i !== index,
    );
    // 削除後に残りのダイアログのIDを再採番
    newDialogues.forEach((dialogue, idx) => {
      dialogue.id = `dialogue_${idx + 1}`;
    });
    editorStore.updateCurrentSection({
      ...currentSection.value,
      dialogues: newDialogues,
    });
  }
};

const updateDialogue = (
  index: number,
  updates: Partial<DemoDialogue>,
): void => {
  if (currentSection.value) {
    const newDialogues = [...currentSection.value.dialogues];
    newDialogues[index] = { ...newDialogues[index], ...updates };
    editorStore.updateCurrentSection({
      ...currentSection.value,
      dialogues: newDialogues,
    });
  }
};

// 表情ピッカーを開く
const openEmotionPicker = (index: number): void => {
  selectedDialogueIndex.value = index;
  const pickerRef = emotionPickerRefs.value[index] as HTMLDialogElement;
  pickerRef?.showModal();
};

// 表情を選択
const handleEmotionSelect = (emotionId: EmotionId): void => {
  if (selectedDialogueIndex.value !== null) {
    updateDialogue(selectedDialogueIndex.value, { emotion: emotionId });
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

// BoardActions 配列操作関数
const addBoardAction = (index: number): void => {
  const dialogue = currentSection.value?.dialogues[index];
  if (!dialogue) {
    return;
  }
  const newBoardActions = [
    ...dialogue.boardActions,
    createBoardAction("place"),
  ];
  updateDialogue(index, { boardActions: newBoardActions });
};

const removeBoardAction = (
  dialogueIndex: number,
  actionIndex: number,
): void => {
  const dialogue = currentSection.value?.dialogues[dialogueIndex];
  if (!dialogue) {
    return;
  }
  const newBoardActions = dialogue.boardActions.filter(
    (_, i) => i !== actionIndex,
  );
  updateDialogue(dialogueIndex, { boardActions: newBoardActions });
};

const moveBoardAction = (
  dialogueIndex: number,
  fromIndex: number,
  toIndex: number,
): void => {
  const dialogue = currentSection.value?.dialogues[dialogueIndex];
  if (!dialogue) {
    return;
  }
  const newBoardActions = [...dialogue.boardActions];
  const [movedAction] = newBoardActions.splice(fromIndex, 1);
  newBoardActions.splice(toIndex, 0, movedAction);
  updateDialogue(dialogueIndex, { boardActions: newBoardActions });
};

const updateBoardActionInArray = (
  dialogueIndex: number,
  actionIndex: number,
  updates: Partial<BoardAction>,
): void => {
  const dialogue = currentSection.value?.dialogues[dialogueIndex];
  if (!dialogue || !dialogue.boardActions[actionIndex]) {
    return;
  }
  const newBoardActions = [...dialogue.boardActions];
  newBoardActions[actionIndex] = {
    ...newBoardActions[actionIndex],
    ...updates,
  } as BoardAction;
  updateDialogue(dialogueIndex, { boardActions: newBoardActions });
};

const updateBoardActionPosition = (
  dialogueIndex: number,
  actionIndex: number,
  key: "position" | "fromPosition" | "toPosition",
  field: "row" | "col",
  value: number,
): void => {
  const dialogue = currentSection.value?.dialogues[dialogueIndex];
  if (!dialogue || !dialogue.boardActions[actionIndex]) {
    return;
  }
  const nextValue = Math.max(0, Math.min(14, value));
  const action = dialogue.boardActions[actionIndex];

  if (
    (action.type === "place" || action.type === "remove") &&
    key === "position"
  ) {
    const updatedPos: Position = { ...action.position, [field]: nextValue };
    updateBoardActionInArray(dialogueIndex, actionIndex, {
      position: updatedPos,
    });
    return;
  }

  if (action.type === "line") {
    if (key === "fromPosition") {
      const updatedPos: Position = {
        ...action.fromPosition,
        [field]: nextValue,
      };
      updateBoardActionInArray(dialogueIndex, actionIndex, {
        fromPosition: updatedPos,
      });
      return;
    }
    if (key === "toPosition") {
      const updatedPos: Position = { ...action.toPosition, [field]: nextValue };
      updateBoardActionInArray(dialogueIndex, actionIndex, {
        toPosition: updatedPos,
      });
    }
  }
};

const updateBoardActionColor = (
  dialogueIndex: number,
  actionIndex: number,
  color: "black" | "white",
): void => {
  const dialogue = currentSection.value?.dialogues[dialogueIndex];
  if (!dialogue || !dialogue.boardActions[actionIndex]) {
    return;
  }
  const action = dialogue.boardActions[actionIndex];
  if (action.type !== "place") {
    return;
  }
  updateBoardActionInArray(dialogueIndex, actionIndex, { color });
};

const updateBoardActionHighlight = (
  dialogueIndex: number,
  actionIndex: number,
  highlight: boolean,
): void => {
  const dialogue = currentSection.value?.dialogues[dialogueIndex];
  if (!dialogue || !dialogue.boardActions[actionIndex]) {
    return;
  }
  const action = dialogue.boardActions[actionIndex];
  if (action.type !== "place") {
    return;
  }
  updateBoardActionInArray(dialogueIndex, actionIndex, { highlight });
};

const updateBoardActionBoard = (
  dialogueIndex: number,
  actionIndex: number,
  text: string,
): void => {
  const dialogue = currentSection.value?.dialogues[dialogueIndex];
  if (!dialogue || !dialogue.boardActions[actionIndex]) {
    return;
  }
  const action = dialogue.boardActions[actionIndex];
  if (action.type !== "setBoard") {
    return;
  }
  const lines = text.split("\n").map((line) => line.trim());
  updateBoardActionInArray(dialogueIndex, actionIndex, { board: lines });
};

const addBoardActionMarkPosition = (
  dialogueIndex: number,
  actionIndex: number,
): void => {
  const dialogue = currentSection.value?.dialogues[dialogueIndex];
  if (!dialogue || !dialogue.boardActions[actionIndex]) {
    return;
  }
  const action = dialogue.boardActions[actionIndex];
  if (action.type !== "mark") {
    return;
  }
  const positions = [...action.positions, { row: 0, col: 0 }];
  updateBoardActionInArray(dialogueIndex, actionIndex, { positions });
};

const updateBoardActionMarkPosition = (
  dialogueIndex: number,
  actionIndex: number,
  posIndex: number,
  field: "row" | "col",
  value: number,
): void => {
  const dialogue = currentSection.value?.dialogues[dialogueIndex];
  if (!dialogue || !dialogue.boardActions[actionIndex]) {
    return;
  }
  const action = dialogue.boardActions[actionIndex];
  if (action.type !== "mark") {
    return;
  }
  const positions = [...action.positions];
  const nextValue = Math.max(0, Math.min(14, value));
  positions[posIndex] = {
    ...positions[posIndex],
    [field]: nextValue,
  } as Position;
  updateBoardActionInArray(dialogueIndex, actionIndex, { positions });
};

const removeBoardActionMarkPosition = (
  dialogueIndex: number,
  actionIndex: number,
  posIndex: number,
): void => {
  const dialogue = currentSection.value?.dialogues[dialogueIndex];
  if (!dialogue || !dialogue.boardActions[actionIndex]) {
    return;
  }
  const action = dialogue.boardActions[actionIndex];
  if (action.type !== "mark") {
    return;
  }
  const positions = action.positions.filter((_, i) => i !== posIndex);
  updateBoardActionInArray(dialogueIndex, actionIndex, { positions });
};

const updateBoardActionMarkMeta = (
  dialogueIndex: number,
  actionIndex: number,
  updates: Partial<Extract<BoardAction, { type: "mark" }>>,
): void => {
  const dialogue = currentSection.value?.dialogues[dialogueIndex];
  if (!dialogue || !dialogue.boardActions[actionIndex]) {
    return;
  }
  updateBoardActionInArray(dialogueIndex, actionIndex, updates);
};

const updateBoardActionLine = (
  dialogueIndex: number,
  actionIndex: number,
  updates: Partial<Extract<BoardAction, { type: "line" }>>,
): void => {
  const dialogue = currentSection.value?.dialogues[dialogueIndex];
  if (!dialogue || !dialogue.boardActions[actionIndex]) {
    return;
  }
  updateBoardActionInArray(dialogueIndex, actionIndex, updates);
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
          />
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
                  readonly
                  disabled
                  title="ダイアログIDは自動採番されます（読み取り専用）"
                />
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
                    class="btn-move"
                    :disabled="index === 0"
                    @click.prevent="editorStore.moveDialogueUp(index)"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    class="btn-move"
                    :disabled="index === currentSection.dialogues.length - 1"
                    @click.prevent="editorStore.moveDialogueDown(index)"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    class="btn-remove-small"
                    @click.prevent="removeDialogue(index)"
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
                    updateDialogue(index, {
                      text: parseDialogueText(
                        (e.target as HTMLTextAreaElement).value,
                      ),
                    })
                "
              />
              <div class="board-action-block">
                <div class="board-action-header">
                  <span>Board Actions</span>
                  <button
                    type="button"
                    class="btn-add-small btn-inline"
                    @click.prevent="addBoardAction(index)"
                  >
                    + 追加
                  </button>
                </div>

                <div
                  v-if="dialogue.boardActions.length === 0"
                  class="empty-state"
                >
                  アクションがありません
                </div>

                <div
                  v-else
                  class="board-actions-list"
                >
                  <div
                    v-for="(action, actionIndex) in dialogue.boardActions"
                    :key="`action-${actionIndex}`"
                    class="board-action-item"
                  >
                    <div class="action-header">
                      <span class="action-index">アクション {{ actionIndex + 1 }}</span>
                      <div class="action-buttons">
                        <button
                          type="button"
                          class="btn-move"
                          :disabled="actionIndex === 0"
                          @click.prevent="
                            moveBoardAction(index, actionIndex, actionIndex - 1)
                          "
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          class="btn-move"
                          :disabled="
                            actionIndex === dialogue.boardActions.length - 1
                          "
                          @click.prevent="
                            moveBoardAction(index, actionIndex, actionIndex + 1)
                          "
                        >
                          ▼
                        </button>
                        <button
                          type="button"
                          class="btn-remove-small"
                          @click.prevent="removeBoardAction(index, actionIndex)"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <div class="board-action-body">
                      <div class="field-row">
                        <label>タイプ</label>
                        <select
                          :value="action.type"
                          class="form-input form-input-small"
                          @change="
                            (e) =>
                              updateBoardActionInArray(index, actionIndex, {
                                type: (e.target as HTMLSelectElement)
                                  .value as BoardAction['type'],
                              })
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
                        v-if="action.type === 'place'"
                        class="board-action-section"
                      >
                        <div class="field-row">
                          <label>行</label>
                          <input
                            type="number"
                            min="0"
                            max="14"
                            :value="action.position.row"
                            class="form-input form-input-small"
                            @input="
                              (e) =>
                                updateBoardActionPosition(
                                  index,
                                  actionIndex,
                                  'position',
                                  'row',
                                  Number((e.target as HTMLInputElement).value),
                                )
                            "
                          />
                          <label>列</label>
                          <input
                            type="number"
                            min="0"
                            max="14"
                            :value="action.position.col"
                            class="form-input form-input-small"
                            @input="
                              (e) =>
                                updateBoardActionPosition(
                                  index,
                                  actionIndex,
                                  'position',
                                  'col',
                                  Number((e.target as HTMLInputElement).value),
                                )
                            "
                          />
                        </div>
                        <div class="field-row">
                          <label>色</label>
                          <select
                            :value="action.color"
                            class="form-input form-input-small"
                            @change="
                              (e) =>
                                updateBoardActionColor(
                                  index,
                                  actionIndex,
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
                              :checked="action.highlight"
                              @change="
                                (e) =>
                                  updateBoardActionHighlight(
                                    index,
                                    actionIndex,
                                    (e.target as HTMLInputElement).checked,
                                  )
                              "
                            />
                            ハイライト
                          </label>
                        </div>
                      </div>

                      <div
                        v-else-if="action.type === 'remove'"
                        class="board-action-section"
                      >
                        <div class="field-row">
                          <label>行</label>
                          <input
                            type="number"
                            min="0"
                            max="14"
                            :value="action.position.row"
                            class="form-input form-input-small"
                            @input="
                              (e) =>
                                updateBoardActionPosition(
                                  index,
                                  actionIndex,
                                  'position',
                                  'row',
                                  Number((e.target as HTMLInputElement).value),
                                )
                            "
                          />
                          <label>列</label>
                          <input
                            type="number"
                            min="0"
                            max="14"
                            :value="action.position.col"
                            class="form-input form-input-small"
                            @input="
                              (e) =>
                                updateBoardActionPosition(
                                  index,
                                  actionIndex,
                                  'position',
                                  'col',
                                  Number((e.target as HTMLInputElement).value),
                                )
                            "
                          />
                        </div>
                      </div>

                      <div
                        v-else-if="action.type === 'setBoard'"
                        class="board-action-section"
                      >
                        <label>盤面データ (15行)</label>
                        <textarea
                          :value="action.board.join('\n')"
                          class="form-textarea"
                          rows="6"
                          placeholder="eで空白、x=黒、o=白"
                          @input="
                            (e) =>
                              updateBoardActionBoard(
                                index,
                                actionIndex,
                                (e.target as HTMLTextAreaElement).value,
                              )
                          "
                        />
                      </div>

                      <div
                        v-else-if="action.type === 'mark'"
                        class="board-action-section"
                      >
                        <div class="field-row">
                          <label>マーク</label>
                          <select
                            :value="action.markType"
                            class="form-input form-input-small"
                            @change="
                              (e) =>
                                updateBoardActionMarkMeta(index, actionIndex, {
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
                            :value="action.label || ''"
                            class="form-input form-input-small"
                            placeholder="ラベル (任意)"
                            @input="
                              (e) =>
                                updateBoardActionMarkMeta(index, actionIndex, {
                                  label: (e.target as HTMLInputElement).value,
                                })
                            "
                          />
                        </div>
                        <div class="positions-list">
                          <div
                            v-for="(pos, posIndex) in action.positions"
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
                                    actionIndex,
                                    posIndex,
                                    'row',
                                    Number(
                                      (e.target as HTMLInputElement).value,
                                    ),
                                  )
                              "
                            />
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
                                    actionIndex,
                                    posIndex,
                                    'col',
                                    Number(
                                      (e.target as HTMLInputElement).value,
                                    ),
                                  )
                              "
                            />
                            <button
                              type="button"
                              class="btn-inline"
                              @click.prevent="
                                removeBoardActionMarkPosition(
                                  index,
                                  actionIndex,
                                  posIndex,
                                )
                              "
                            >
                              削除
                            </button>
                          </div>
                          <button
                            type="button"
                            class="btn-add-small btn-inline"
                            @click.prevent="
                              addBoardActionMarkPosition(index, actionIndex)
                            "
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
                              :value="action.fromPosition.row"
                              class="form-input form-input-small"
                              @input="
                                (e) =>
                                  updateBoardActionPosition(
                                    index,
                                    actionIndex,
                                    'fromPosition',
                                    'row',
                                    Number(
                                      (e.target as HTMLInputElement).value,
                                    ),
                                  )
                              "
                            />
                            <input
                              type="number"
                              min="0"
                              max="14"
                              :value="action.fromPosition.col"
                              class="form-input form-input-small"
                              @input="
                                (e) =>
                                  updateBoardActionPosition(
                                    index,
                                    actionIndex,
                                    'fromPosition',
                                    'col',
                                    Number(
                                      (e.target as HTMLInputElement).value,
                                    ),
                                  )
                              "
                            />
                          </div>
                          <div class="position-row">
                            <label>終了 行/列</label>
                            <input
                              type="number"
                              min="0"
                              max="14"
                              :value="action.toPosition.row"
                              class="form-input form-input-small"
                              @input="
                                (e) =>
                                  updateBoardActionPosition(
                                    index,
                                    actionIndex,
                                    'toPosition',
                                    'row',
                                    Number(
                                      (e.target as HTMLInputElement).value,
                                    ),
                                  )
                              "
                            />
                            <input
                              type="number"
                              min="0"
                              max="14"
                              :value="action.toPosition.col"
                              class="form-input form-input-small"
                              @input="
                                (e) =>
                                  updateBoardActionPosition(
                                    index,
                                    actionIndex,
                                    'toPosition',
                                    'col',
                                    Number(
                                      (e.target as HTMLInputElement).value,
                                    ),
                                  )
                              "
                            />
                          </div>
                        </div>
                        <div class="field-row">
                          <label>アクション</label>
                          <select
                            :value="action.action"
                            class="form-input form-input-small"
                            @change="
                              (e) =>
                                updateBoardActionLine(index, actionIndex, {
                                  action: (e.target as HTMLSelectElement)
                                    .value as 'draw' | 'remove',
                                })
                            "
                          >
                            <option value="draw">draw</option>
                            <option value="remove">remove</option>
                          </select>
                          <label>線の種類</label>
                          <select
                            :value="action.style || 'solid'"
                            class="form-input form-input-small"
                            @change="
                              (e) =>
                                updateBoardActionLine(index, actionIndex, {
                                  style: (e.target as HTMLSelectElement)
                                    .value as 'solid' | 'dashed',
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
            </div>
          </div>
        </details>
      </div>
    </div>

    <!-- 表情ピッカーダイアログ -->
    <template v-if="currentSection">
      <EmotionPickerDialog
        v-for="(dialogue, index) in currentSection.dialogues"
        :key="`emotion-picker-${dialogue.id}`"
        :ref="
          (el: any) => {
            if (el) emotionPickerRefs[index] = el;
          }
        "
        :character="dialogue.character as CharacterType"
        @select="handleEmotionSelect"
      />
    </template>
  </div>
</template>

<style scoped>
.demo-section-editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--size-8);
  align-items: start;
}

.detail-left,
.detail-right {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
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

.form-input {
  padding: var(--size-2);
  border: 1px solid var(--color-border-heavy);
  border-radius: 3px;
  font-size: var(--size-12);
  font-family: inherit;
}

.form-input:focus {
  outline: none;
  border-color: #4a90e2;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.05);
}

.board-editor-wrapper {
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: var(--size-6);
}

.board-editor-wrapper summary {
  cursor: pointer;
  font-weight: 600;
  font-size: var(--size-12);
  margin-bottom: var(--size-5);
  user-select: none;
}

.board-editor-wrapper summary:hover {
  color: #4a90e2;
}

.dialogues-section {
  padding: var(--size-6);
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
  font-size: var(--size-12);
  margin-bottom: var(--size-5);
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
  align-items: flex-start;
  flex-wrap: wrap;
}

.dialogue-actions-buttons {
  display: flex;
  gap: var(--size-2);
  margin-left: auto;
}

.btn-move {
  padding: var(--size-2) var(--size-5);
  background-color: #4a90e2;
  border: none;
  cursor: pointer;
  font-size: var(--size-10);
  border-radius: 3px;
  transition: opacity 0.2s;
}

.btn-move:hover:not(:disabled) {
  opacity: 0.8;
}

.btn-move:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.form-input-small {
  flex: 1;
  min-width: var(--size-100);
  padding: var(--size-2);
  font-size: var(--size-10);
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

.emotion-selector-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 50px;
  height: 36px;
  padding: 4px;
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-10);
  transition: all 0.2s;
}

.emotion-selector-button:hover {
  border-color: var(--color-primary);
  background-color: var(--color-background-hover);
}

.emotion-selector-button .placeholder {
  font-size: var(--size-9);
  color: var(--color-text-secondary);
}

.form-textarea {
  padding: var(--size-2);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: var(--size-10);
  font-family: inherit;
  resize: vertical;
}

.form-textarea:focus {
  outline: none;
  border-color: #4a90e2;
}

.dialogue-hint {
  color: var(--color-text-secondary);
  font-style: italic;
  font-size: var(--size-10);
}

.board-action-block {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  padding: var(--size-5);
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.board-action-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.board-actions-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
}

.board-action-item {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
  padding: var(--size-5);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.action-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--size-5);
}

.action-index {
  font-weight: 600;
  font-size: var(--size-11);
}

.action-buttons {
  display: flex;
  gap: var(--size-2);
}

.board-action-body {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
}

.board-action-section {
  display: flex;
  flex-direction: column;
  gap: var(--size-5);
}

.field-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-5);
}

.positions-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
}

.position-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2);
  align-items: center;
}

.btn-inline {
  padding: var(--size-2) var(--size-6);
  border: 1px solid var(--color-border);
  background-color: white;
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-10);
}

.btn-inline:hover {
  background-color: var(--color-background-soft);
}

.checkbox-inline {
  display: flex;
  gap: var(--size-2);
  align-items: center;
}
</style>
