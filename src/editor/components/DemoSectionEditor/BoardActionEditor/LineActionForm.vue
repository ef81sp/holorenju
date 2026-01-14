<script setup lang="ts">
import { computed } from "vue";
import { clampPosition, type LineAction } from "./types";

const props = defineProps<{
  action: LineAction;
}>();

const emit = defineEmits<{
  "update-position": [
    key: "fromPosition" | "toPosition",
    field: "row" | "col",
    value: number,
  ];
  "update-action": [action: "draw" | "remove"];
  "update-style": [style: "solid" | "dashed"];
}>();

const fromPosition = computed(() => props.action.fromPosition);
const toPosition = computed(() => props.action.toPosition);

const lineAction = computed({
  get: (): string => props.action.action,
  set: (value: string) => {
    emit("update-action", value as "draw" | "remove");
  },
});

const lineStyle = computed({
  get: (): string => props.action.style || "solid",
  set: (value: string) => {
    emit("update-style", value as "solid" | "dashed");
  },
});

const handlePositionChange = (
  key: "fromPosition" | "toPosition",
  field: "row" | "col",
  value: string,
): void => {
  emit("update-position", key, field, clampPosition(value));
};
</script>

<template>
  <div class="action-form inline-fields">
    <label class="field">
      <span>開始</span>
      <div class="position-inputs">
        <input
          type="number"
          placeholder="row"
          min="0"
          max="14"
          :value="fromPosition.row"
          @change="
            (e) =>
              handlePositionChange(
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
          :value="fromPosition.col"
          @change="
            (e) =>
              handlePositionChange(
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
          :value="toPosition.row"
          @change="
            (e) =>
              handlePositionChange(
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
          :value="toPosition.col"
          @change="
            (e) =>
              handlePositionChange(
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

<style scoped>
.action-form {
  display: flex;
  gap: var(--size-4);
}

.inline-fields {
  display: flex;
  gap: var(--size-4);
  flex-wrap: wrap;
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
</style>
