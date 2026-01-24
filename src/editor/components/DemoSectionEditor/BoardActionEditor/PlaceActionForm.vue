<script setup lang="ts">
import { computed } from "vue";
import PositionInput from "@/editor/components/common/PositionInput.vue";
import type { PlaceAction } from "./types";

const props = defineProps<{
  action: PlaceAction;
}>();

const emit = defineEmits<{
  "update-position": [field: "row" | "col", value: number];
  "update-color": [color: "black" | "white"];
  "update-highlight": [highlight: boolean];
}>();

const position = computed(() => props.action.position);

const color = computed({
  get: (): "black" | "white" => props.action.color,
  set: (value: "black" | "white") => emit("update-color", value),
});

const highlight = computed({
  get: (): boolean => props.action.highlight ?? false,
  set: (value: boolean) => emit("update-highlight", value),
});

const handlePositionUpdate = (field: "row" | "col", value: number): void => {
  emit("update-position", field, value);
};
</script>

<template>
  <div class="action-form">
    <label class="field">
      <span>位置</span>
      <PositionInput
        :row="position.row"
        :col="position.col"
        @update-position="handlePositionUpdate"
      />
    </label>

    <div class="field field-small">
      <span>色</span>
      <div class="radio-group">
        <label class="radio-label">
          <input
            v-model="color"
            type="radio"
            value="black"
          />
          黒
        </label>
        <label class="radio-label">
          <input
            v-model="color"
            type="radio"
            value="white"
          />
          白
        </label>
      </div>
    </div>

    <label class="field checkbox-field">
      <span>ハイライト</span>
      <div class="checkbox-inline">
        <input
          v-model="highlight"
          type="checkbox"
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

.radio-group {
  display: flex;
  gap: var(--size-8);
}

.radio-label {
  display: flex;
  align-items: center;
  gap: var(--size-2);
  font-size: var(--size-12);
  cursor: pointer;
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
</style>
