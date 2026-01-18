<script setup lang="ts">
import { computed } from "vue";
import PositionInput from "@/editor/components/common/PositionInput.vue";
import type { RemoveAction } from "./types";

const props = defineProps<{
  action: RemoveAction;
}>();

const emit = defineEmits<{
  "update-position": [field: "row" | "col", value: number];
}>();

const position = computed(() => props.action.position);

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
</style>
