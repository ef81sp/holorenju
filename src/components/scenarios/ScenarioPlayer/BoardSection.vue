<script setup lang="ts">
import RenjuBoard from "@/components/game/RenjuBoard.vue";
import KeyboardControlInfo from "./KeyboardControlInfo.vue";
import type { BoardState, Position } from "@/types/game";

interface Props {
  boardState: BoardState;
  disabled: boolean;
  stageSize: number;
  cursorPosition: Position;
}

defineProps<Props>();

const emits = defineEmits<{
  placeStone: [position: Position];
}>();
</script>

<template>
  <div class="board-section">
    <div class="board-wrapper">
      <!-- Keyboard control UI -->
      <KeyboardControlInfo :cursor-position="cursorPosition" />
      <RenjuBoard
        :board-state="boardState"
        :disabled="disabled"
        :stage-size="stageSize"
        :cursor-position="cursorPosition"
        @place-stone="emits('placeStone', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.board-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--size-12);
  overflow: hidden;
  min-height: 0;
  width: 100%;
  height: 100%;
}

.board-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--size-12);
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  overflow: hidden;
}
</style>
