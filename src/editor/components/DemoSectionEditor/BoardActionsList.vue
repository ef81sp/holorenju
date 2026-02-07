<script setup lang="ts">
import type { BoardAction, DemoSection, DemoDialogue } from "@/types/scenario";
import BoardActionEditor from "./BoardActionEditor/BoardActionEditor.vue";
import { useBoardActions } from "@/editor/composables/useBoardActions";

const props = defineProps<{
  dialogueIndex: number;
  boardActions: BoardAction[];
  getCurrentSection: () => DemoSection | null;
  updateDialogue: (index: number, updates: Partial<DemoDialogue>) => void;
}>();

const {
  addBoardAction,
  removeBoardAction,
  moveBoardAction,
  updateBoardActionInArray,
  updateBoardActionPosition,
  updateBoardActionColor,
  updateBoardActionBoard,
  addBoardActionMarkPosition,
  updateBoardActionMarkPosition,
  removeBoardActionMarkPosition,
  updateBoardActionMarkMeta,
  updateBoardActionLine,
  updateBoardActionType,
} = useBoardActions(props.getCurrentSection, props.updateDialogue);

const handleAddAction = (): void => {
  addBoardAction(props.dialogueIndex);
};

const handleRemove = (actionIndex: number): void => {
  removeBoardAction(props.dialogueIndex, actionIndex);
};

const handleMove = (fromIndex: number, toIndex: number): void => {
  moveBoardAction(props.dialogueIndex, fromIndex, toIndex);
};

const handleUpdate = (
  actionIndex: number,
  updates: Partial<BoardAction>,
): void => {
  updateBoardActionInArray(props.dialogueIndex, actionIndex, updates);
};

const handleUpdatePosition = (
  actionIndex: number,
  key: "position" | "fromPosition" | "toPosition",
  field: "row" | "col",
  value: number,
): void => {
  updateBoardActionPosition(
    props.dialogueIndex,
    actionIndex,
    key,
    field,
    value,
  );
};

const handleUpdateColor = (
  actionIndex: number,
  color: "black" | "white",
): void => {
  updateBoardActionColor(props.dialogueIndex, actionIndex, color);
};

const handleUpdateBoard = (actionIndex: number, board: string[]): void => {
  updateBoardActionBoard(props.dialogueIndex, actionIndex, board);
};

const handleAddMarkPosition = (actionIndex: number): void => {
  addBoardActionMarkPosition(props.dialogueIndex, actionIndex);
};

const handleUpdateMarkPosition = (
  actionIndex: number,
  posIndex: number,
  field: "row" | "col",
  value: number,
): void => {
  updateBoardActionMarkPosition(
    props.dialogueIndex,
    actionIndex,
    posIndex,
    field,
    value,
  );
};

const handleRemoveMarkPosition = (
  actionIndex: number,
  posIndex: number,
): void => {
  removeBoardActionMarkPosition(props.dialogueIndex, actionIndex, posIndex);
};

const handleUpdateMarkMeta = (
  actionIndex: number,
  updates: Partial<Extract<BoardAction, { type: "mark" }>>,
): void => {
  updateBoardActionMarkMeta(props.dialogueIndex, actionIndex, updates);
};

const handleUpdateLine = (
  actionIndex: number,
  updates: Partial<Extract<BoardAction, { type: "line" }>>,
): void => {
  updateBoardActionLine(props.dialogueIndex, actionIndex, updates);
};

const handleUpdateType = (
  actionIndex: number,
  newType: BoardAction["type"],
): void => {
  updateBoardActionType(props.dialogueIndex, actionIndex, newType);
};
</script>

<template>
  <div class="board-actions-list">
    <div class="actions-header">
      <h3>ボードアクション</h3>
      <button
        type="button"
        class="add-button"
        @click="handleAddAction"
      >
        + 追加
      </button>
    </div>

    <template v-if="boardActions.length === 0">
      <p class="empty-message">
        アクションが登録されていません。右上の追加ボタンで追加してください。
      </p>
    </template>

    <template v-else>
      <div class="actions-list">
        <div
          v-for="(action, actionIndex) in boardActions"
          :key="`board-action-${actionIndex}`"
          class="action-item"
        >
          <div class="action-item-controls">
            <button
              type="button"
              class="move-button"
              :disabled="actionIndex === 0"
              @click="handleMove(actionIndex, actionIndex - 1)"
            >
              ▲
            </button>

            <button
              type="button"
              class="move-button"
              :disabled="actionIndex === boardActions.length - 1"
              @click="handleMove(actionIndex, actionIndex + 1)"
            >
              ▼
            </button>
          </div>

          <BoardActionEditor
            :action="action"
            :dialogue-index="props.dialogueIndex"
            :action-index="actionIndex"
            @update="(updates) => handleUpdate(actionIndex, updates)"
            @update-position="
              (key, field, value) =>
                handleUpdatePosition(actionIndex, key, field, value)
            "
            @update-color="(color) => handleUpdateColor(actionIndex, color)"
            @update-board="(board) => handleUpdateBoard(actionIndex, board)"
            @add-mark-position="() => handleAddMarkPosition(actionIndex)"
            @update-mark-position="
              (posIndex, field, value) =>
                handleUpdateMarkPosition(actionIndex, posIndex, field, value)
            "
            @remove-mark-position="
              (posIndex) => handleRemoveMarkPosition(actionIndex, posIndex)
            "
            @update-mark-meta="
              (updates) => handleUpdateMarkMeta(actionIndex, updates)
            "
            @update-line="(updates) => handleUpdateLine(actionIndex, updates)"
            @update-type="(newType) => handleUpdateType(actionIndex, newType)"
            @remove="() => handleRemove(actionIndex)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.board-actions-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
  margin-top: var(--size-6);
}

.actions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: var(--font-weight-bold);
  font-size: var(--size-12);
}

.add-button {
  padding: var(--size-4) var(--size-8);
  background: var(--color-holo-blue);
  color: white;
  border: none;
  border-radius: 3px;
  font-weight: var(--font-weight-bold);
  font-size: var(--size-10);
}

.add-button:hover {
  opacity: 0.9;
}

.empty-message {
  color: var(--color-text-secondary);
  font-style: italic;
  text-align: center;
  padding: var(--size-8) var(--size-6);
  border: 1px dashed var(--color-border);
  border-radius: 3px;
}

.actions-list {
  max-height: var(--size-200);
  overflow-y: auto;
}

.action-item {
  display: flex;
  gap: var(--size-4);
}

.action-item-controls {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
  padding-top: var(--size-4);
}

.move-button {
  width: var(--size-20);
  height: var(--size-20);
  padding: 0;
  background: var(--color-bg-gray);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  font-weight: var(--font-weight-bold);
  font-size: var(--size-10);
  display: flex;
  align-items: center;
  justify-content: center;
}

.move-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
