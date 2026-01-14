<script setup lang="ts">
import { computed } from "vue";
import { clampPosition, type MarkAction } from "./types";

const props = defineProps<{
  action: MarkAction;
}>();

const emit = defineEmits<{
  "add-position": [];
  "update-position": [posIndex: number, field: "row" | "col", value: number];
  "remove-position": [posIndex: number];
  "update-mark-type": [markType: "circle" | "cross" | "arrow"];
}>();

const positions = computed(() => props.action.positions);

const markType = computed({
  get: (): string => props.action.markType,
  set: (value: string) => {
    emit("update-mark-type", value as "circle" | "cross" | "arrow");
  },
});

const handleAddPosition = (): void => {
  emit("add-position");
};

const handleUpdatePosition = (
  posIndex: number,
  field: "row" | "col",
  value: string,
): void => {
  emit("update-position", posIndex, field, clampPosition(value));
};

const handleRemovePosition = (posIndex: number): void => {
  emit("remove-position", posIndex);
};
</script>

<template>
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
            @click="handleAddPosition"
          >
            追加
          </button>
        </div>

        <div
          v-for="(pos, posIndex) in positions"
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
                  handleUpdatePosition(
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
                  handleUpdatePosition(
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
            @click="handleRemovePosition(posIndex)"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.action-form {
  display: flex;
  gap: var(--size-4);
}

.inline-fields {
  display: flex;
  gap: var(--size-4);
  width: 100%;
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

.field-small select {
  padding: var(--size-3) var(--size-5);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-family: inherit;
  font-size: var(--size-12);
  color: var(--color-text-primary);
  background: var(--color-bg-white);
}

.field-small select:focus {
  outline: none;
  border-color: var(--color-holo-blue);
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

.positions-header span {
  font-weight: var(--font-weight-bold);
  font-size: var(--size-11);
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

.add-position-button:hover {
  opacity: 0.9;
}

.position-item {
  display: flex;
  gap: var(--size-2);
  align-items: center;
}

.position-item .position-inputs {
  flex: 1;
}

.position-inputs {
  display: flex;
  align-items: center;
  gap: var(--size-2);
}

.position-inputs input[type="number"] {
  width: var(--size-24);
  padding: var(--size-3) var(--size-5);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-family: inherit;
  font-size: var(--size-12);
  color: var(--color-text-primary);
  background: var(--color-bg-white);
}

.position-inputs input[type="number"]:focus {
  outline: none;
  border-color: var(--color-holo-blue);
}

.position-inputs .separator {
  font-weight: var(--font-weight-bold);
  color: var(--color-text-secondary);
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

.remove-position-button:hover {
  opacity: 0.9;
}
</style>
