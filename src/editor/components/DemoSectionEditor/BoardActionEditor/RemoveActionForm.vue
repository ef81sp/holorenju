<script setup lang="ts">
import { computed } from "vue";
import { clampPosition, type RemoveAction } from "./types";

const props = defineProps<{
  action: RemoveAction;
}>();

const emit = defineEmits<{
  "update-position": [field: "row" | "col", value: number];
}>();

const position = computed(() => props.action.position);

const handlePositionChange = (field: "row" | "col", value: string): void => {
  emit("update-position", field, clampPosition(value));
};
</script>

<template>
  <div class="action-form">
    <label class="field">
      <span>位置</span>
      <div class="position-inputs">
        <input
          type="number"
          placeholder="row"
          min="0"
          max="14"
          :value="position.row"
          @change="
            (e) =>
              handlePositionChange('row', (e.target as HTMLInputElement).value)
          "
        />
        <span class="separator">×</span>
        <input
          type="number"
          placeholder="col"
          min="0"
          max="14"
          :value="position.col"
          @change="
            (e) =>
              handlePositionChange('col', (e.target as HTMLInputElement).value)
          "
        />
      </div>
    </label>
  </div>
</template>

<style scoped>
.action-form {
  display: flex;
  gap: var(--size-4);
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
</style>
