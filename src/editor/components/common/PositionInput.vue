<script setup lang="ts">
import { computed } from "vue";
import {
  internalRowToDisplay,
  displayRowToInternal,
  internalColToDisplay,
  displayColToInternal,
  clampDisplayRow,
  COLUMN_OPTIONS,
} from "@/editor/utils/coordinateUtils";

const props = defineProps<{
  row: number;
  col: number;
}>();

const emit = defineEmits<{
  "update-position": [field: "row" | "col", value: number];
}>();

const displayRow = computed(() => internalRowToDisplay(props.row));
const displayCol = computed(() => internalColToDisplay(props.col));

const handleRowChange = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  const displayValue = clampDisplayRow(parseInt(input.value, 10) || 1);
  const internalValue = displayRowToInternal(displayValue);
  emit("update-position", "row", internalValue);
};

const handleColChange = (event: Event): void => {
  const select = event.target as HTMLSelectElement;
  const internalValue = displayColToInternal(select.value);
  emit("update-position", "col", internalValue);
};
</script>

<template>
  <div class="position-inputs">
    <input
      type="number"
      min="1"
      max="15"
      :value="displayRow"
      @change="handleRowChange"
    />
    <span class="separator">,</span>
    <select
      :value="displayCol"
      @change="handleColChange"
    >
      <option
        v-for="colLabel in COLUMN_OPTIONS"
        :key="colLabel"
        :value="colLabel"
      >
        {{ colLabel }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.position-inputs {
  display: flex;
  align-items: center;
  gap: var(--size-2);
}

.position-inputs input[type="number"] {
  width: var(--size-32);
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

.position-inputs select {
  width: var(--size-32);
  padding: var(--size-3) var(--size-5);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-family: inherit;
  font-size: var(--size-12);
  color: var(--color-text-primary);
  background: var(--color-bg-white);
}

.position-inputs select:focus {
  outline: none;
  border-color: var(--color-holo-blue);
}

.position-inputs .separator {
  font-weight: var(--font-weight-bold);
  color: var(--color-text-secondary);
}
</style>
