<script setup lang="ts">
import { computed } from "vue";
import PositionInput from "@/editor/components/common/PositionInput.vue";
import type { LineAction } from "./types";

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

const handleFromPositionUpdate = (
  field: "row" | "col",
  value: number,
): void => {
  emit("update-position", "fromPosition", field, value);
};

const handleToPositionUpdate = (field: "row" | "col", value: number): void => {
  emit("update-position", "toPosition", field, value);
};
</script>

<template>
  <div class="action-form inline-fields">
    <label class="field">
      <span>開始</span>
      <PositionInput
        :row="fromPosition.row"
        :col="fromPosition.col"
        @update-position="handleFromPositionUpdate"
      />
    </label>

    <label class="field">
      <span>終了</span>
      <PositionInput
        :row="toPosition.row"
        :col="toPosition.col"
        @update-position="handleToPositionUpdate"
      />
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
