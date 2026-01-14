<script setup lang="ts">
import { computed } from "vue";
import BoardVisualEditor from "../../BoardVisualEditor.vue";
import type { SetBoardAction } from "./types";

const props = defineProps<{
  action: SetBoardAction;
}>();

const emit = defineEmits<{
  "update-board": [board: string[]];
}>();

const boardData = computed(() => props.action.board);

const handleBoardUpdate = (newBoard: string[]): void => {
  emit("update-board", newBoard);
};
</script>

<template>
  <div class="action-form board-editor-form">
    <BoardVisualEditor
      :board="boardData"
      :stage-size="250"
      @update:board="handleBoardUpdate"
    />
  </div>
</template>

<style scoped>
.action-form.board-editor-form {
  display: flex;
  flex-direction: column;
  padding: var(--size-4);
}
</style>
