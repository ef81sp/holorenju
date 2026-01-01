<script setup lang="ts">
import { computed, type PropType } from "vue";
import { useEditorStore } from "@/editor/stores/editorStore";
import BoardVisualEditor from "./BoardVisualEditor.vue";
import type {
  ProblemSection,
  SuccessCondition,
  PositionCondition,
  PatternCondition,
  SequenceCondition,
  Hint,
  DialogueLine,
} from "@/types/scenario";
import type { Position } from "@/types/game";
import type { CharacterType, Emotion } from "@/types/character";

const editorStore = useEditorStore();

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

const currentSection = computed<ProblemSection | null>(() => {
  const section = editorStore.currentSection;
  return section && section.type === "problem"
    ? (section as ProblemSection)
    : null;
});

const isPositionCondition = (
  condition: SuccessCondition,
): condition is PositionCondition => condition.type === "position";
const isPatternCondition = (
  condition: SuccessCondition,
): condition is PatternCondition => condition.type === "pattern";
const isSequenceCondition = (
  condition: SuccessCondition,
): condition is SequenceCondition => condition.type === "sequence";

const updateBoard = (newBoard: string[]): void => {
  if (currentSection.value) {
    editorStore.updateCurrentSection({
      initialBoard: newBoard,
    });
  }
};

const updateSectionTitle = (title: string): void => {
  if (currentSection.value) {
    editorStore.updateCurrentSection({
      title,
    });
  }
};

const updateDescription = (description: string): void => {
  if (currentSection.value) {
    editorStore.updateCurrentSection({
      description,
    });
  }
};

const setSuccessConditions = (conditions: SuccessCondition[]): void => {
  if (currentSection.value) {
    editorStore.updateCurrentSection({ successConditions: conditions });
  }
};

const addSuccessCondition = (): void => {
  if (!currentSection.value) {
    return;
  }
  const newCondition: PositionCondition = {
    type: "position",
    positions: [],
    color: "black",
  };
  setSuccessConditions([
    ...currentSection.value.successConditions,
    newCondition,
  ]);
};

const removeSuccessCondition = (index: number): void => {
  if (!currentSection.value) {
    return;
  }
  const newConditions = currentSection.value.successConditions.filter(
    (_, i) => i !== index,
  );
  setSuccessConditions(newConditions);
};

const changeConditionType = (index: number, type: SuccessCondition["type"]): void => {
  if (!currentSection.value) {
    return;
  }
  const newConditions = [...currentSection.value.successConditions];
  let baseCondition: SuccessCondition = {
    type: "position",
    positions: [],
    color: "black",
  };
  if (type === "position") {
    baseCondition = { type: "position", positions: [], color: "black" };
  } else if (type === "pattern") {
    baseCondition = { type: "pattern", pattern: "", color: "black" };
  } else {
    baseCondition = { type: "sequence", moves: [], strict: false };
  }
  newConditions[index] = baseCondition;
  setSuccessConditions(newConditions);
};

const updatePositionCondition = (
  index: number,
  updates: Partial<PositionCondition>,
): void => {
  if (!currentSection.value) {
    return;
  }
  const condition = currentSection.value.successConditions[index];
  if (!condition || !isPositionCondition(condition)) {
    return;
  }
  const updated: PositionCondition = {
    ...condition,
    ...updates,
    positions: updates.positions ?? condition.positions ?? [],
    color: updates.color ?? condition.color,
  };
  const newConditions = [...currentSection.value.successConditions];
  newConditions[index] = updated;
  setSuccessConditions(newConditions);
};

const addPositionToCondition = (conditionIndex: number): void => {
  if (!currentSection.value) {
    return;
  }
  const condition = currentSection.value.successConditions[conditionIndex];
  if (!condition || !isPositionCondition(condition)) {
    return;
  }
  const positions = [...(condition.positions || [])];
  positions.push({ row: 0, col: 0 });
  updatePositionCondition(conditionIndex, { positions });
};

const updatePositionField = (
  conditionIndex: number,
  positionIndex: number,
  field: "row" | "col",
  value: number,
): void => {
  if (!currentSection.value) {
    return;
  }
  const condition = currentSection.value.successConditions[conditionIndex];
  if (!condition || !isPositionCondition(condition)) {
    return;
  }
  const positions = [...(condition.positions || [])];
  const nextValue = Math.max(0, Math.min(14, value));
  positions[positionIndex] = {
    ...positions[positionIndex],
    [field]: nextValue,
  } as Position;
  updatePositionCondition(conditionIndex, { positions });
};

const removePositionFromCondition = (
  conditionIndex: number,
  positionIndex: number,
): void => {
  if (!currentSection.value) {
    return;
  }
  const condition = currentSection.value.successConditions[conditionIndex];
  if (!condition || !isPositionCondition(condition)) {
    return;
  }
  const positions = (condition.positions || []).filter(
    (_, i) => i !== positionIndex,
  );
  updatePositionCondition(conditionIndex, { positions });
};

const updatePatternCondition = (
  index: number,
  updates: Partial<PatternCondition>,
): void => {
  if (!currentSection.value) {
    return;
  }
  const condition = currentSection.value.successConditions[index];
  if (!condition || !isPatternCondition(condition)) {
    return;
  }
  const newConditions = [...currentSection.value.successConditions];
  newConditions[index] = {
    ...condition,
    ...updates,
    pattern: updates.pattern ?? condition.pattern,
    color: updates.color ?? condition.color,
  };
  setSuccessConditions(newConditions);
};

const addSequenceMove = (index: number): void => {
  if (!currentSection.value) {
    return;
  }
  const condition = currentSection.value.successConditions[index];
  if (!condition || !isSequenceCondition(condition)) {
    return;
  }
  const moves = [
    ...condition.moves,
    { row: 0, col: 0, color: "black" as const },
  ];
  const newConditions = [...currentSection.value.successConditions];
  newConditions[index] = { ...condition, moves };
  setSuccessConditions(newConditions);
};

const updateSequenceMove = (
  conditionIndex: number,
  moveIndex: number,
  field: "row" | "col" | "color",
  value: number | "black" | "white",
): void => {
  if (!currentSection.value) {
    return;
  }
  const condition = currentSection.value.successConditions[conditionIndex];
  if (!condition || !isSequenceCondition(condition)) {
    return;
  }
  const moves = [...condition.moves];
  if (field === "color") {
    moves[moveIndex] = {
      ...moves[moveIndex],
      color: value as "black" | "white",
    };
  } else {
    const nextValue = Math.max(0, Math.min(14, value as number));
    moves[moveIndex] = {
      ...moves[moveIndex],
      [field]: nextValue,
    } as SequenceCondition["moves"][number];
  }
  const newConditions = [...currentSection.value.successConditions];
  newConditions[conditionIndex] = { ...condition, moves };
  setSuccessConditions(newConditions);
};

const removeSequenceMove = (conditionIndex: number, moveIndex: number): void => {
  if (!currentSection.value) {
    return;
  }
  const condition = currentSection.value.successConditions[conditionIndex];
  if (!condition || !isSequenceCondition(condition)) {
    return;
  }
  const moves = condition.moves.filter((_, i) => i !== moveIndex);
  const newConditions = [...currentSection.value.successConditions];
  newConditions[conditionIndex] = { ...condition, moves };
  setSuccessConditions(newConditions);
};

const toggleSequenceStrict = (index: number, strict: boolean): void => {
  if (!currentSection.value) {
    return;
  }
  const condition = currentSection.value.successConditions[index];
  if (!condition || !isSequenceCondition(condition)) {
    return;
  }
  const newConditions = [...currentSection.value.successConditions];
  newConditions[index] = { ...condition, strict };
  setSuccessConditions(newConditions);
};

const getHints = (): Hint[] => currentSection.value?.hints ?? [];

const setHints = (hints: Hint[]): void => {
  if (currentSection.value) {
    editorStore.updateCurrentSection({ hints });
  }
};

const addHint = (): void => {
  const hints = getHints();
  const nextLevel = hints.length + 1;
  const newHint: Hint = {
    level: nextLevel,
    dialogue: { character: "", text: "" },
    marks: { positions: [], markType: "circle" },
  };
  setHints([...hints, newHint]);
};

const removeHint = (index: number): void => {
  const hints = getHints().filter((_, i) => i !== index);
  setHints(hints);
};

const updateHint = (index: number, updates: Partial<Hint>): void => {
  const hints = getHints();
  const target = hints[index];
  if (!target) {
    return;
  }
  const newHints = [...hints];
  newHints[index] = { ...target, ...updates } as Hint;
  setHints(newHints);
};

const updateHintDialogueField = (
  index: number,
  field: "character" | "text" | "emotion",
  value: string,
): void => {
  const hints = getHints();
  const target = hints[index];
  if (!target) {
    return;
  }
  const newDialogue = {
    character: "",
    text: "",
    ...target.dialogue,
    [field]: value,
  };
  updateHint(index, { dialogue: newDialogue });
};

const updateHintMarks = (
  index: number,
  updates: Partial<NonNullable<Hint["marks"]>>,
): void => {
  const hints = getHints();
  const target = hints[index];
  if (!target) {
    return;
  }
  const marks = { positions: [], ...target.marks, ...updates } as NonNullable<
    Hint["marks"]
  >;
  updateHint(index, { marks });
};

const addHintMarkPosition = (index: number): void => {
  const hints = getHints();
  const target = hints[index];
  if (!target) {
    return;
  }
  const marks: {
    positions: Position[];
    markType: "circle" | "cross" | "arrow";
  } = { positions: [], markType: "circle", ...target.marks };
  const positions = [...(marks.positions || []), { row: 0, col: 0 }];
  updateHintMarks(index, { positions });
};

const updateHintMarkPosition = (
  index: number,
  posIndex: number,
  field: "row" | "col",
  value: number,
): void => {
  const hints = getHints();
  const target = hints[index];
  if (!target || !target.marks) {
    return;
  }
  const positions = [...target.marks.positions];
  const nextValue = Math.max(0, Math.min(14, value));
  positions[posIndex] = {
    ...positions[posIndex],
    [field]: nextValue,
  } as Position;
  updateHintMarks(index, { positions });
};

const removeHintMarkPosition = (index: number, posIndex: number): void => {
  const hints = getHints();
  const target = hints[index];
  if (!target || !target.marks) {
    return;
  }
  const positions = target.marks.positions.filter((_, i) => i !== posIndex);
  updateHintMarks(index, { positions });
};

type FeedbackKey = "success" | "failure" | "progress";

const getFeedbackLines = (key: FeedbackKey): DialogueLine[] => {
  if (!currentSection.value) {
    return [];
  }
  const { feedback } = currentSection.value;
  const lines = feedback[key];
  if (Array.isArray(lines)) {
    return lines;
  }
  return [];
};

const updateFeedbackLines = (key: FeedbackKey, lines: DialogueLine[]): void => {
  if (!currentSection.value) {
    return;
  }
  editorStore.updateCurrentSection({
    feedback: {
      ...currentSection.value.feedback,
      [key]: lines,
    },
  });
};

const addFeedbackLine = (key: FeedbackKey): void => {
  const lines = getFeedbackLines(key);
  updateFeedbackLines(key, [
    ...lines,
    { character: "", text: "", emotion: "" },
  ]);
};

const updateFeedbackLine = (
  key: FeedbackKey,
  index: number,
  updates: Partial<DialogueLine>,
): void => {
  const lines = getFeedbackLines(key);
  if (!lines[index]) {
    return;
  }
  const newLines = [...lines];
  newLines[index] = { ...newLines[index], ...updates } as DialogueLine;
  updateFeedbackLines(key, newLines);
};

const removeFeedbackLine = (key: FeedbackKey, index: number): void => {
  const lines = getFeedbackLines(key).filter((_, i) => i !== index);
  updateFeedbackLines(key, lines);
};
</script>

<template>
  <div
    v-if="currentSection"
    class="problem-section-editor"
  >
    <div class="detail-grid">
      <div
        v-if="props.view !== 'content'"
        class="detail-left"
      >
        <!-- セクション情報 -->
        <div class="form-group">
          <label for="problem-title">セクションタイトル</label>
          <input
            id="problem-title"
            type="text"
            :value="currentSection.title"
            class="form-input"
            @input="
              (e) => updateSectionTitle((e.target as HTMLInputElement).value)
            "
          >
        </div>

        <!-- 説明 -->
        <div class="form-group">
          <label for="problem-description">説明</label>
          <textarea
            id="problem-description"
            :value="currentSection.description"
            class="form-textarea"
            rows="4"
            @input="
              (e) => updateDescription((e.target as HTMLTextAreaElement).value)
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

        <!-- 成功条件 -->
        <details
          class="conditions-section"
          open
        >
          <summary class="conditions-header">
            <span>成功条件</span>
            <button
              class="btn-add-small"
              @click.stop="addSuccessCondition"
            >
              + 条件を追加
            </button>
          </summary>

          <div
            v-if="currentSection.successConditions.length === 0"
            class="empty-state"
          >
            成功条件がありません
          </div>

          <div
            v-else
            class="conditions-list"
          >
            <div
              v-for="(condition, index) in currentSection.successConditions"
              :key="index"
              class="condition-item"
            >
              <div class="condition-header">
                <select
                  :value="condition.type"
                  class="form-input form-input-small"
                  @change="
                    (e) =>
                      changeConditionType(
                        index,
                        (e.target as HTMLSelectElement)
                          .value as SuccessCondition['type'],
                      )
                  "
                >
                  <option value="position">Position (位置指定)</option>
                  <option value="pattern">Pattern (パターン)</option>
                  <option value="sequence">Sequence (手順)</option>
                </select>
                <button
                  class="btn-remove-small"
                  @click="removeSuccessCondition(index)"
                >
                  ✕
                </button>
              </div>

              <div
                v-if="condition.type === 'position'"
                class="condition-body"
              >
                <div class="field-row">
                  <label>色</label>
                  <select
                    :value="condition.color"
                    class="form-input form-input-small"
                    @change="
                      (e) =>
                        updatePositionCondition(index, {
                          color: (e.target as HTMLSelectElement).value as
                            | 'black'
                            | 'white',
                        })
                    "
                  >
                    <option value="black">黒</option>
                    <option value="white">白</option>
                  </select>
                </div>
                <div class="positions-list">
                  <div
                    v-for="(pos, posIndex) in condition.positions"
                    :key="`pos-${posIndex}`"
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
                          updatePositionField(
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
                          updatePositionField(
                            index,
                            posIndex,
                            'col',
                            Number((e.target as HTMLInputElement).value),
                          )
                      "
                    >
                    <button
                      class="btn-inline"
                      @click="removePositionFromCondition(index, posIndex)"
                    >
                      座標削除
                    </button>
                  </div>
                  <button
                    class="btn-add-small btn-inline"
                    @click="addPositionToCondition(index)"
                  >
                    + 座標を追加
                  </button>
                </div>
              </div>

              <div
                v-else-if="condition.type === 'pattern'"
                class="condition-body"
              >
                <div class="field-row">
                  <label>色</label>
                  <select
                    :value="condition.color"
                    class="form-input form-input-small"
                    @change="
                      (e) =>
                        updatePatternCondition(index, {
                          color: (e.target as HTMLSelectElement).value as
                            | 'black'
                            | 'white',
                        })
                    "
                  >
                    <option value="black">黒</option>
                    <option value="white">白</option>
                  </select>
                </div>
                <div class="field-row">
                  <label>パターン</label>
                  <input
                    type="text"
                    :value="condition.pattern"
                    class="form-input"
                    placeholder="例: xxo..."
                    @input="
                      (e) =>
                        updatePatternCondition(index, {
                          pattern: (e.target as HTMLInputElement).value,
                        })
                    "
                  >
                </div>
              </div>

              <div
                v-else
                class="condition-body"
              >
                <div class="field-row checkbox-row">
                  <label>
                    <input
                      type="checkbox"
                      :checked="condition.strict"
                      @change="
                        (e) =>
                          toggleSequenceStrict(
                            index,
                            (e.target as HTMLInputElement).checked,
                          )
                      "
                    >
                    strict（順序厳密）
                  </label>
                </div>
                <div class="moves-list">
                  <div
                    v-for="(move, moveIndex) in condition.moves"
                    :key="`move-${moveIndex}`"
                    class="move-row"
                  >
                    <label>行</label>
                    <input
                      type="number"
                      min="0"
                      max="14"
                      :value="move.row"
                      class="form-input form-input-small"
                      @input="
                        (e) =>
                          updateSequenceMove(
                            index,
                            moveIndex,
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
                      :value="move.col"
                      class="form-input form-input-small"
                      @input="
                        (e) =>
                          updateSequenceMove(
                            index,
                            moveIndex,
                            'col',
                            Number((e.target as HTMLInputElement).value),
                          )
                      "
                    >
                    <label>色</label>
                    <select
                      :value="move.color"
                      class="form-input form-input-small"
                      @change="
                        (e) =>
                          updateSequenceMove(
                            index,
                            moveIndex,
                            'color',
                            (e.target as HTMLSelectElement).value as
                              | 'black'
                              | 'white',
                          )
                      "
                    >
                      <option value="black">黒</option>
                      <option value="white">白</option>
                    </select>
                    <button
                      class="btn-inline"
                      @click="removeSequenceMove(index, moveIndex)"
                    >
                      手を削除
                    </button>
                  </div>
                  <button
                    class="btn-add-small btn-inline"
                    @click="addSequenceMove(index)"
                  >
                    + 手を追加
                  </button>
                </div>
              </div>
            </div>
          </div>
        </details>

        <!-- ヒント -->
        <details
          class="hints-section"
          open
        >
          <summary class="conditions-header">
            <span>ヒント</span>
            <button
              class="btn-add-small"
              @click.stop="addHint"
            >
              + ヒントを追加
            </button>
          </summary>

          <div
            v-if="!currentSection.hints || currentSection.hints.length === 0"
            class="empty-state"
          >
            ヒントがありません（任意）
          </div>

          <div
            v-else
            class="hints-list"
          >
            <div
              v-for="(hint, index) in currentSection.hints"
              :key="index"
              class="hint-item"
            >
              <div class="hint-header">
                <label>レベル</label>
                <input
                  type="number"
                  min="1"
                  :value="hint.level"
                  class="form-input form-input-small"
                  @input="
                    (e) =>
                      updateHint(index, {
                        level: Number((e.target as HTMLInputElement).value),
                      })
                  "
                >
                <button
                  class="btn-remove-small"
                  @click="removeHint(index)"
                >
                  ✕
                </button>
              </div>

              <div class="hint-dialogue">
                <input
                  type="text"
                  :value="hint.dialogue?.character || ''"
                  class="form-input form-input-small"
                  placeholder="キャラクター"
                  @input="
                    (e) =>
                      updateHintDialogueField(
                        index,
                        'character',
                        (e.target as HTMLInputElement).value,
                      )
                  "
                >
                <input
                  type="text"
                  :value="hint.dialogue?.emotion || ''"
                  class="form-input form-input-small"
                  placeholder="感情 (任意)"
                  @input="
                    (e) =>
                      updateHintDialogueField(
                        index,
                        'emotion',
                        (e.target as HTMLInputElement).value,
                      )
                  "
                >
                <textarea
                  :value="hint.dialogue?.text || ''"
                  class="form-textarea"
                  rows="2"
                  placeholder="ヒントのテキスト"
                  @input="
                    (e) =>
                      updateHintDialogueField(
                        index,
                        'text',
                        (e.target as HTMLTextAreaElement).value,
                      )
                  "
                />
              </div>

              <div class="hint-marks">
                <div class="field-row">
                  <label>マーク種別</label>
                  <select
                    :value="hint.marks?.markType || 'circle'"
                    class="form-input form-input-small"
                    @change="
                      (e) =>
                        updateHintMarks(index, {
                          markType: (e.target as HTMLSelectElement).value as
                            | 'circle'
                            | 'cross'
                            | 'arrow',
                        })
                    "
                  >
                    <option value="circle">Circle</option>
                    <option value="cross">Cross</option>
                    <option value="arrow">Arrow</option>
                  </select>
                </div>

                <div class="positions-list">
                  <div
                    v-for="(pos, posIndex) in hint.marks?.positions || []"
                    :key="`hint-pos-${posIndex}`"
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
                          updateHintMarkPosition(
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
                          updateHintMarkPosition(
                            index,
                            posIndex,
                            'col',
                            Number((e.target as HTMLInputElement).value),
                          )
                      "
                    >
                    <button
                      class="btn-inline"
                      @click="removeHintMarkPosition(index, posIndex)"
                    >
                      マーク削除
                    </button>
                  </div>
                  <button
                    class="btn-add-small btn-inline"
                    @click="addHintMarkPosition(index)"
                  >
                    + マーク座標を追加
                  </button>
                </div>
              </div>
            </div>
          </div>
        </details>

        <!-- フィードバック -->
        <details
          class="feedback-section"
          open
        >
          <summary>フィードバック</summary>

          <div class="feedback-groups">
            <div class="feedback-group">
              <div class="feedback-header">
                <span>成功時</span>
                <button
                  class="btn-add-small"
                  @click.stop="addFeedbackLine('success')"
                >
                  + 行を追加
                </button>
              </div>
              <div
                v-if="getFeedbackLines('success').length === 0"
                class="empty-state"
              >
                メッセージがありません
              </div>
              <div
                v-else
                class="feedback-lines"
              >
                <div
                  v-for="(line, index) in getFeedbackLines('success')"
                  :key="`success-${index}`"
                  class="feedback-line"
                >
                  <div class="feedback-meta-row">
                    <span class="field-label">キャラクター</span>
                    <select
                      :value="line.character"
                      class="form-input form-input-small"
                      @change="
                        (e) =>
                          updateFeedbackLine('success', index, {
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
                    <span class="field-label">感情</span>
                    <select
                      :value="line.emotion || ''"
                      class="form-input form-input-small"
                      @change="
                        (e) =>
                          updateFeedbackLine('success', index, {
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
                  </div>
                  <div class="feedback-text-row">
                    <textarea
                      :value="line.text"
                      class="form-textarea"
                      rows="2"
                      placeholder="テキスト"
                      @input="
                        (e) =>
                          updateFeedbackLine('success', index, {
                            text: (e.target as HTMLTextAreaElement).value,
                          })
                      "
                    />
                    <button
                      class="btn-remove-small"
                      @click="removeFeedbackLine('success', index)"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="feedback-group">
              <div class="feedback-header">
                <span>失敗時</span>
                <button
                  class="btn-add-small"
                  @click.stop="addFeedbackLine('failure')"
                >
                  + 行を追加
                </button>
              </div>
              <div
                v-if="getFeedbackLines('failure').length === 0"
                class="empty-state"
              >
                メッセージがありません
              </div>
              <div
                v-else
                class="feedback-lines"
              >
                <div
                  v-for="(line, index) in getFeedbackLines('failure')"
                  :key="`failure-${index}`"
                  class="feedback-line"
                >
                  <div class="feedback-meta-row">
                    <span class="field-label">キャラクター</span>
                    <select
                      :value="line.character"
                      class="form-input form-input-small"
                      @change="
                        (e) =>
                          updateFeedbackLine('failure', index, {
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
                    <span class="field-label">感情</span>
                    <select
                      :value="line.emotion || ''"
                      class="form-input form-input-small"
                      @change="
                        (e) =>
                          updateFeedbackLine('failure', index, {
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
                  </div>
                  <div class="feedback-text-row">
                    <textarea
                      :value="line.text"
                      class="form-textarea"
                      rows="2"
                      placeholder="テキスト"
                      @input="
                        (e) =>
                          updateFeedbackLine('failure', index, {
                            text: (e.target as HTMLTextAreaElement).value,
                          })
                      "
                    />
                    <button
                      class="btn-remove-small"
                      @click="removeFeedbackLine('failure', index)"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="feedback-group">
              <div class="feedback-header">
                <span>進行中 (任意)</span>
                <button
                  class="btn-add-small"
                  @click.stop="addFeedbackLine('progress')"
                >
                  + 行を追加
                </button>
              </div>
              <div
                v-if="getFeedbackLines('progress').length === 0"
                class="empty-state"
              >
                中間メッセージがありません
              </div>
              <div
                v-else
                class="feedback-lines"
              >
                <div
                  v-for="(line, index) in getFeedbackLines('progress')"
                  :key="`progress-${index}`"
                  class="feedback-line"
                >
                  <div class="feedback-meta-row">
                    <span class="field-label">キャラクター</span>
                    <select
                      :value="line.character"
                      class="form-input form-input-small"
                      @change="
                        (e) =>
                          updateFeedbackLine('progress', index, {
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
                    <span class="field-label">感情</span>
                    <select
                      :value="line.emotion || ''"
                      class="form-input form-input-small"
                      @change="
                        (e) =>
                          updateFeedbackLine('progress', index, {
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
                  </div>
                  <div class="feedback-text-row">
                    <textarea
                      :value="line.text"
                      class="form-textarea"
                      rows="2"
                      placeholder="テキスト"
                      @input="
                        (e) =>
                          updateFeedbackLine('progress', index, {
                            text: (e.target as HTMLTextAreaElement).value,
                          })
                      "
                    />
                    <button
                      class="btn-remove-small"
                      @click="removeFeedbackLine('progress', index)"
                    >
                      ✕
                    </button>
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
.problem-section-editor {
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

.form-input,
.form-textarea {
  padding: calc(var(--size-unit) * 0.3);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: calc(var(--size-unit) * 1.1);
  font-family: inherit;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.05);
}

.form-textarea {
  resize: vertical;
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

.conditions-section,
.feedback-section {
  padding: calc(var(--size-unit) * 0.6);
  background-color: var(--color-background-soft);
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.conditions-section summary,
.feedback-section summary {
  cursor: pointer;
  font-weight: 600;
  font-size: calc(var(--size-unit) * 1.1);
  margin-bottom: calc(var(--size-unit) * 0.5);
  user-select: none;
}

.conditions-section summary:hover,
.feedback-section summary:hover {
  color: var(--color-primary);
}

.conditions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.conditions-header span {
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

.conditions-list {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.6);
}

.condition-item {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.4);
  padding: calc(var(--size-unit) * 0.6);
  background-color: white;
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.condition-header {
  display: flex;
  gap: calc(var(--size-unit) * 0.3);
  align-items: center;
}

.form-input-small {
  flex: 1;
  min-width: calc(var(--size-unit) * 8);
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

.condition-body {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.5);
  padding-top: calc(var(--size-unit) * 0.4);
}

.field-row {
  display: flex;
  gap: calc(var(--size-unit) * 0.4);
  flex-wrap: wrap;
  align-items: center;
}

.checkbox-row label {
  display: flex;
  gap: calc(var(--size-unit) * 0.3);
  align-items: center;
}

.positions-list,
.moves-list {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.4);
}

.position-row,
.move-row {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--size-unit) * 0.4);
  align-items: center;
}

.btn-inline {
  padding: calc(var(--size-unit) * 0.3) calc(var(--size-unit) * 0.5);
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  font-size: calc(var(--size-unit) * 1);
}

.btn-inline:hover {
  background-color: #f0f0f0;
}

.hints-section {
  padding: calc(var(--size-unit) * 0.6);
  background-color: var(--color-background-soft);
  border-radius: 3px;
  border: 1px solid var(--color-border);
}

.hints-list {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.6);
}

.hint-item {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.4);
  padding: calc(var(--size-unit) * 0.6);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.hint-header {
  display: flex;
  gap: calc(var(--size-unit) * 0.4);
  align-items: center;
}

.hint-dialogue,
.hint-marks {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.4);
}

.feedback-groups {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.6);
}

.feedback-group {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.4);
  padding: calc(var(--size-unit) * 0.6);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.feedback-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.feedback-lines {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.4);
}

.feedback-line {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.3);
  padding: calc(var(--size-unit) * 0.5);
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 3px;
}

.feedback-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: calc(var(--size-unit) * 0.4);
}

.feedback-text-row {
  display: flex;
  gap: calc(var(--size-unit) * 0.4);
  align-items: flex-start;
}

.feedback-text-row textarea {
  flex: 1;
}

.field-label {
  color: var(--color-fubuki-primary);
  font-weight: 600;
  font-size: calc(var(--size-unit) * 0.9);
}
</style>
