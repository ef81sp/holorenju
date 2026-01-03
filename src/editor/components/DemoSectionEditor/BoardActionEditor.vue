<script setup lang="ts">
import type { Position } from "@/types/game";
import type { BoardAction } from "@/types/scenario";
import { computed } from "vue";

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
  "update-highlight": [highlight: boolean];
  "update-board": [text: string];
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
  remove: [];
}>();

// ===== type guards =====
const isPlaceAction = computed(() => props.action.type === "place");
const isRemoveAction = computed(() => props.action.type === "remove");
const isSetBoardAction = computed(() => props.action.type === "setBoard");
const isMarkAction = computed(() => props.action.type === "mark");
const isLineAction = computed(() => props.action.type === "line");

// ===== Place アクション =====
const placePosition = computed(() => {
  if (!isPlaceAction.value) {
    return null;
  }
  return (props.action as Extract<BoardAction, { type: "place" }>).position;
});

const placeColor = computed({
  get: (): "black" | "white" => {
    if (!isPlaceAction.value) {
      return "black";
    }
    return (props.action as Extract<BoardAction, { type: "place" }>).color;
  },
  set: (value: "black" | "white") => {
    emit("update-color", value);
  },
});

const placeHighlight = computed({
  get: (): boolean => {
    if (!isPlaceAction.value) {
      return false;
    }
    return (props.action as Extract<BoardAction, { type: "place" }>).highlight;
  },
  set: (value: boolean) => {
    emit("update-highlight", value);
  },
});

const handlePlacePositionChange = (
  field: "row" | "col",
  value: string,
): void => {
  const numValue = Math.max(0, Math.min(14, parseInt(value, 10) || 0));
  emit("update-position", "position", field, numValue);
};

// ===== Remove アクション =====
const removePosition = computed(() => {
  if (!isRemoveAction.value) {
    return null;
  }
  return (props.action as Extract<BoardAction, { type: "remove" }>).position;
});

const handleRemovePositionChange = (
  field: "row" | "col",
  value: string,
): void => {
  const numValue = Math.max(0, Math.min(14, parseInt(value, 10) || 0));
  emit("update-position", "position", field, numValue);
};

// ===== SetBoard アクション =====
const setBoardContent = computed({
  get: (): string => {
    if (!isSetBoardAction.value) {
      return "";
    }
    return (
      props.action as Extract<BoardAction, { type: "setBoard" }>
    ).board.join("\n");
  },
  set: (value: string) => {
    emit("update-board", value);
  },
});

// ===== Mark アクション =====
const markPositions = computed(() => {
  if (!isMarkAction.value) {
    return [];
  }
  return (props.action as Extract<BoardAction, { type: "mark" }>).positions;
});

const markType = computed({
  get: (): string => {
    if (!isMarkAction.value) {
      return "circle";
    }
    return (props.action as Extract<BoardAction, { type: "mark" }>).markType;
  },
  set: (value: string) => {
    emit("update-mark-meta", {
      markType: value as "circle" | "cross" | "arrow",
    });
  },
});

const handleAddMarkPosition = (): void => {
  emit("add-mark-position");
};

const handleUpdateMarkPosition = (
  posIndex: number,
  field: "row" | "col",
  value: string,
): void => {
  const numValue = Math.max(0, Math.min(14, parseInt(value, 10) || 0));
  emit("update-mark-position", posIndex, field, numValue);
};

const handleRemoveMarkPosition = (posIndex: number): void => {
  emit("remove-mark-position", posIndex);
};

// ===== Line アクション =====
const lineFromPosition = computed(() => {
  if (!isLineAction.value) {
    return { row: 0, col: 0 };
  }
  return (props.action as Extract<BoardAction, { type: "line" }>).fromPosition;
});

const lineToPosition = computed(() => {
  if (!isLineAction.value) {
    return { row: 0, col: 0 };
  }
  return (props.action as Extract<BoardAction, { type: "line" }>).toPosition;
});

const lineAction = computed({
  get: (): string => {
    if (!isLineAction.value) {
      return "draw";
    }
    return (props.action as Extract<BoardAction, { type: "line" }>).action;
  },
  set: (value: string) => {
    emit("update-line", { action: value as "draw" | "remove" });
  },
});

const lineStyle = computed({
  get: (): string => {
    if (!isLineAction.value) {
      return "solid";
    }
    return (
      (props.action as Extract<BoardAction, { type: "line" }>).style || "solid"
    );
  },
  set: (value: string) => {
    emit("update-line", { style: value as "solid" | "dashed" });
  },
});

const handleLinePositionChange = (
  key: "fromPosition" | "toPosition",
  field: "row" | "col",
  value: string,
): void => {
  const numValue = Math.max(0, Math.min(14, parseInt(value, 10) || 0));
  emit("update-position", key, field, numValue);
};
</script>

<template>
  <div class="board-action-editor">
    <div class="action-header">
      <h4>アクション #{{ actionIndex + 1 }} ({{ action.type }})</h4>
      <button
        type="button"
        class="remove-button"
        @click="emit('remove')"
      >
        削除
      </button>
    </div>

    <!-- Place Action -->
    <template v-if="isPlaceAction">
      <div class="action-form">
        <label class="field">
          <span>位置</span>
          <div class="position-inputs">
            <input
              type="number"
              placeholder="row"
              min="0"
              max="14"
              :value="placePosition?.row || 0"
              @change="
                (e) =>
                  handlePlacePositionChange(
                    'row',
                    (e.target as HTMLInputElement).value,
                  )
              "
            />
            <span class="separator">×</span>
            <input
              type="number"
              placeholder="col"
              min="0"
              max="14"
              :value="placePosition?.col || 0"
              @change="
                (e) =>
                  handlePlacePositionChange(
                    'col',
                    (e.target as HTMLInputElement).value,
                  )
              "
            />
          </div>
        </label>

        <label class="field field-small">
          <span>色</span>
          <select v-model="placeColor">
            <option value="black">黒</option>
            <option value="white">白</option>
          </select>
        </label>

        <label class="field checkbox-field">
          <span>ハイライト</span>
          <div class="checkbox-inline">
            <input
              v-model="placeHighlight"
              type="checkbox"
            />
          </div>
        </label>
      </div>
    </template>

    <!-- Remove Action -->
    <template v-else-if="isRemoveAction">
      <div class="action-form">
        <label class="field">
          <span>位置</span>
          <div class="position-inputs">
            <input
              type="number"
              placeholder="row"
              min="0"
              max="14"
              :value="removePosition?.row || 0"
              @change="
                (e) =>
                  handleRemovePositionChange(
                    'row',
                    (e.target as HTMLInputElement).value,
                  )
              "
            />
            <span class="separator">×</span>
            <input
              type="number"
              placeholder="col"
              min="0"
              max="14"
              :value="removePosition?.col || 0"
              @change="
                (e) =>
                  handleRemovePositionChange(
                    'col',
                    (e.target as HTMLInputElement).value,
                  )
              "
            />
          </div>
        </label>
      </div>
    </template>

    <!-- SetBoard Action -->
    <template v-else-if="isSetBoardAction">
      <div class="action-form">
        <label class="field full-width">
          <span>盤面（テキスト）</span>
          <textarea
            v-model="setBoardContent"
            placeholder="e = 空, b = 黒, w = 白"
            rows="4"
          />
        </label>
      </div>
    </template>

    <!-- Mark Action -->
    <template v-else-if="isMarkAction">
      <div class="action-form">
        <div class="inline-fields">
          <label class="field field-small">
            <span>マーク</span>
            <select v-model="markType">
              <option value="circle">円</option>
              <option value="cross">クロス</option>
              <option value="arrow">矢印</option>
            </select>
          </label>

          <div class="positions-container compact">
            <div class="positions-header">
              <span>座標</span>
              <button
                type="button"
                class="add-position-button"
                @click="handleAddMarkPosition"
              >
                追加
              </button>
            </div>

            <div
              v-for="(pos, posIndex) in markPositions"
              :key="`mark-pos-${posIndex}`"
              class="position-item"
            >
              <div class="position-inputs">
                <input
                  type="number"
                  placeholder="row"
                  min="0"
                  max="14"
                  :value="pos.row"
                  @change="
                    (e) =>
                      handleUpdateMarkPosition(
                        posIndex,
                        'row',
                        (e.target as HTMLInputElement).value,
                      )
                  "
                />
                <span class="separator">×</span>
                <input
                  type="number"
                  placeholder="col"
                  min="0"
                  max="14"
                  :value="pos.col"
                  @change="
                    (e) =>
                      handleUpdateMarkPosition(
                        posIndex,
                        'col',
                        (e.target as HTMLInputElement).value,
                      )
                  "
                />
              </div>
              <button
                type="button"
                class="remove-position-button"
                @click="handleRemoveMarkPosition(posIndex)"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Line Action -->
    <template v-else-if="isLineAction">
      <div class="action-form inline-fields">
        <label class="field">
          <span>開始</span>
          <div class="position-inputs">
            <input
              type="number"
              placeholder="row"
              min="0"
              max="14"
              :value="lineFromPosition.row"
              @change="
                (e) =>
                  handleLinePositionChange(
                    'fromPosition',
                    'row',
                    (e.target as HTMLInputElement).value,
                  )
              "
            />
            <span class="separator">×</span>
            <input
              type="number"
              placeholder="col"
              min="0"
              max="14"
              :value="lineFromPosition.col"
              @change="
                (e) =>
                  handleLinePositionChange(
                    'fromPosition',
                    'col',
                    (e.target as HTMLInputElement).value,
                  )
              "
            />
          </div>
        </label>

        <label class="field">
          <span>終了</span>
          <div class="position-inputs">
            <input
              type="number"
              placeholder="row"
              min="0"
              max="14"
              :value="lineToPosition.row"
              @change="
                (e) =>
                  handleLinePositionChange(
                    'toPosition',
                    'row',
                    (e.target as HTMLInputElement).value,
                  )
              "
            />
            <span class="separator">×</span>
            <input
              type="number"
              placeholder="col"
              min="0"
              max="14"
              :value="lineToPosition.col"
              @change="
                (e) =>
                  handleLinePositionChange(
                    'toPosition',
                    'col',
                    (e.target as HTMLInputElement).value,
                  )
              "
            />
          </div>
        </label>

        <label class="field field-small">
          <span>アクション</span>
          <select v-model="lineAction">
            <option value="draw">描画</option>
            <option value="remove">削除</option>
          </select>
        </label>

        <label class="field field-small">
          <span>スタイル</span>
          <select v-model="lineStyle">
            <option value="solid">実線</option>
            <option value="dashed">破線</option>
          </select>
        </label>
      </div>
    </template>
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
  padding-bottom: var(--size-4);
  border-bottom: 1px solid var(--color-border);
}

.action-header h4 {
  margin: 0;
  font-weight: var(--font-weight-bold);
  font-size: var(--size-12);
  color: var(--color-text-primary);
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

.action-form {
  display: flex;
  gap: var(--size-4);
}

input[type="number"],
input[type="text"],
select,
textarea {
  padding: var(--size-3) var(--size-5);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-family: inherit;
  font-size: var(--size-12);
  color: var(--color-text-primary);
  background: var(--color-bg-white);
}

input[type="number"]:focus,
input[type="text"]:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: var(--color-holo-blue);
}

textarea {
  font-family: monospace;
  resize: vertical;
}

.position-inputs {
  display: flex;
  align-items: center;
  gap: var(--size-2);
}

.position-inputs input[type="number"] {
  width: var(--size-24);
}

.position-inputs .separator {
  font-weight: var(--font-weight-bold);
  color: var(--color-text-secondary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
  min-width: var(--size-120);
  flex: 1;
}

.field span {
  font-weight: var(--font-weight-bold);
  font-size: var(--size-11);
}

.field-small {
  max-width: var(--size-120);
  flex: 0 0 auto;
}

.checkbox-field {
  flex: 0 0 auto;
  min-width: var(--size-100);
  align-items: center;
}

.checkbox-inline {
  display: flex;
  align-items: center;
  gap: var(--size-2);
  font-size: var(--size-11);
  height: var(--size-16);
}

.positions-container {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
  min-width: var(--size-160);
}

.positions-container.compact {
  flex: 1;
}

.positions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--size-2);
}

.add-position-button {
  padding: var(--size-3) var(--size-6);
  background: var(--color-holo-cyan);
  color: white;
  border: none;
  border-radius: 3px;
  font-weight: var(--font-weight-bold);
  font-size: var(--size-10);
}

.position-item {
  display: flex;
  gap: var(--size-2);
  align-items: center;
}

.position-item .position-inputs {
  flex: 1;
}

.remove-position-button {
  padding: var(--size-2) var(--size-4);
  background: var(--color-miko-bg);
  color: var(--color-miko-primary);
  border: 1px solid var(--color-miko-primary);
  border-radius: 3px;
  font-weight: var(--font-weight-bold);
  font-size: var(--size-10);
}

.remove-position-button:hover,
.add-position-button:hover,
.remove-button:hover {
  opacity: 0.9;
}
</style>
