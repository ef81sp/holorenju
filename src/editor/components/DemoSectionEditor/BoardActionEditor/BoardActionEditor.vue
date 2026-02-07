<script setup lang="ts">
import { BOARD_ACTION_TYPES, type BoardAction } from "@/types/scenario";
import { computed } from "vue";
import PlaceActionForm from "./PlaceActionForm.vue";
import RemoveActionForm from "./RemoveActionForm.vue";
import SetBoardActionForm from "./SetBoardActionForm.vue";
import MarkActionForm from "./MarkActionForm.vue";
import LineActionForm from "./LineActionForm.vue";
import ResetAllActionForm from "./ResetAllActionForm.vue";
import ResetMarkLineActionForm from "./ResetMarkLineActionForm.vue";
import type {
  PlaceAction,
  RemoveAction,
  SetBoardAction,
  MarkAction,
  LineAction,
  ResetAllAction,
} from "./types";

const props = defineProps<{
  action: BoardAction;
  dialogueIndex: number;
  actionIndex: number;
}>();

const emit = defineEmits<{
  update: [updates: Partial<BoardAction>];
  "update-position": [
    key: "position" | "fromPosition" | "toPosition",
    field: "row" | "col",
    value: number,
  ];
  "update-color": [color: "black" | "white"];
  "update-board": [board: string[]];
  "add-mark-position": [];
  "update-mark-position": [
    posIndex: number,
    field: "row" | "col",
    value: number,
  ];
  "remove-mark-position": [posIndex: number];
  "update-mark-meta": [
    updates: Partial<Extract<BoardAction, { type: "mark" }>>,
  ];
  "update-line": [updates: Partial<Extract<BoardAction, { type: "line" }>>];
  "update-type": [newType: BoardAction["type"]];
  remove: [];
}>();

// 型ガード
const isPlaceAction = computed(() => props.action.type === "place");
const isRemoveAction = computed(() => props.action.type === "remove");
const isSetBoardAction = computed(() => props.action.type === "setBoard");
const isMarkAction = computed(() => props.action.type === "mark");
const isLineAction = computed(() => props.action.type === "line");
const isResetAllAction = computed(() => props.action.type === "resetAll");
const isResetMarkLineAction = computed(
  () => props.action.type === "resetMarkLine",
);

// アクションタイプのラベル
const ACTION_TYPE_LABELS: Record<(typeof BOARD_ACTION_TYPES)[number], string> =
  {
    place: "Place",
    remove: "Remove",
    setBoard: "SetBoard",
    mark: "Mark",
    line: "Line",
    resetAll: "ResetAll",
    resetMarkLine: "ResetMarkLine",
  };

// アクションタイプ選択
const actionType = computed({
  get: (): string => props.action.type,
  set: (value: string) => {
    emit("update-type", value as BoardAction["type"]);
  },
});

// 型安全なアクションキャスト
const placeAction = computed(() => props.action as PlaceAction);
const removeAction = computed(() => props.action as RemoveAction);
const setBoardAction = computed(() => props.action as SetBoardAction);
const markAction = computed(() => props.action as MarkAction);
const lineAction = computed(() => props.action as LineAction);

// Place handlers
const handlePlacePositionUpdate = (
  field: "row" | "col",
  value: number,
): void => {
  emit("update-position", "position", field, value);
};

// Remove handlers
const handleRemovePositionUpdate = (
  field: "row" | "col",
  value: number,
): void => {
  emit("update-position", "position", field, value);
};

// Mark handlers
const handleMarkTypeUpdate = (markType: "circle" | "cross" | "arrow"): void => {
  emit("update-mark-meta", { markType });
};

const handleMarkActionUpdate = (action: "draw" | "remove"): void => {
  emit("update-mark-meta", { action });
};

const handleMarkPositionUpdate = (
  posIndex: number,
  field: "row" | "col",
  value: number,
): void => {
  emit("update-mark-position", posIndex, field, value);
};

// Line handlers
const handleLinePositionUpdate = (
  key: "fromPosition" | "toPosition",
  field: "row" | "col",
  value: number,
): void => {
  emit("update-position", key, field, value);
};

const handleLineActionUpdate = (action: "draw" | "remove"): void => {
  emit("update-line", { action });
};

const handleLineStyleUpdate = (style: "solid" | "dashed"): void => {
  emit("update-line", { style });
};
</script>

<template>
  <div class="board-action-editor">
    <div class="action-header">
      <h4>アクション #{{ actionIndex + 1 }}</h4>
      <select
        v-model="actionType"
        class="type-select"
      >
        <option
          v-for="type in BOARD_ACTION_TYPES"
          :key="type"
          :value="type"
        >
          {{ ACTION_TYPE_LABELS[type] }}
        </option>
      </select>
      <button
        type="button"
        class="remove-button"
        @click="emit('remove')"
      >
        削除
      </button>
    </div>

    <PlaceActionForm
      v-if="isPlaceAction"
      :action="placeAction"
      @update-position="handlePlacePositionUpdate"
      @update-color="(color) => emit('update-color', color)"
    />

    <RemoveActionForm
      v-else-if="isRemoveAction"
      :action="removeAction"
      @update-position="handleRemovePositionUpdate"
    />

    <SetBoardActionForm
      v-else-if="isSetBoardAction"
      :action="setBoardAction"
      @update-board="(board) => emit('update-board', board)"
    />

    <MarkActionForm
      v-else-if="isMarkAction"
      :action="markAction"
      @add-position="emit('add-mark-position')"
      @update-position="handleMarkPositionUpdate"
      @remove-position="(posIndex) => emit('remove-mark-position', posIndex)"
      @update-mark-type="handleMarkTypeUpdate"
      @update-action="handleMarkActionUpdate"
    />

    <LineActionForm
      v-else-if="isLineAction"
      :action="lineAction"
      @update-position="handleLinePositionUpdate"
      @update-action="handleLineActionUpdate"
      @update-style="handleLineStyleUpdate"
    />

    <ResetAllActionForm v-else-if="isResetAllAction" />

    <ResetMarkLineActionForm v-else-if="isResetMarkLineAction" />
  </div>
</template>

<style scoped>
.board-action-editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-4);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: var(--size-6);
  background: var(--color-bg-gray);
}

.action-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--size-4);
  padding-bottom: var(--size-4);
  border-bottom: 1px solid var(--color-border);
}

.action-header h4 {
  margin: 0;
  font-weight: var(--font-weight-bold);
  font-size: var(--size-12);
  color: var(--color-text-primary);
  flex: 0 0 auto;
}

.type-select {
  padding: var(--size-3) var(--size-5);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-family: inherit;
  font-size: var(--size-12);
  color: var(--color-text-primary);
  background: var(--color-bg-white);
  flex: 0 0 auto;
}

.type-select:focus {
  outline: none;
  border-color: var(--color-holo-blue);
}

.remove-button {
  padding: var(--size-4) var(--size-6);
  background: var(--color-miko-bg-light, rgba(255, 156, 180, 0.2));
  color: var(--color-miko-primary);
  border: 1px solid var(--color-miko-primary);
  border-radius: 3px;
  font-weight: var(--font-weight-bold);
  font-size: var(--size-10);
}

.remove-button:hover {
  opacity: 0.9;
}
</style>
