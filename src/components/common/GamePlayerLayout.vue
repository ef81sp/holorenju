<script setup lang="ts">
/**
 * ゲームプレイヤー共通レイアウト
 *
 * ScenarioPlayerとCpuGamePlayerで共通のグリッドレイアウトを提供。
 * grid-template-columns: 4fr 8fr 4fr
 * grid-template-rows: 7fr 2fr
 */

import { ref, computed } from "vue";

import { useBoardSize } from "@/components/scenarios/ScenarioPlayer/composables/useBoardSize";

interface Props {
  largeBoard?: boolean;
}

withDefaults(defineProps<Props>(), {
  largeBoard: false,
});

// boardFrameRefを親に公開
const boardFrameRef = ref<HTMLElement | null>(null);
const { boardSize: boardSizeValue } = useBoardSize(boardFrameRef);
const boardSize = computed(() => boardSizeValue.value);

// Exposeでbordサイズと参照を親に公開
defineExpose({
  boardFrameRef,
  boardSize,
});
</script>

<template>
  <div :class="['game-player-layout', { 'large-board': largeBoard }]">
    <!-- 操作セクション（左上 4×7）-->
    <div class="control-section-slot">
      <div class="control-header">
        <slot name="back-button" />
        <div class="header-controls">
          <slot name="header-controls" />
        </div>
      </div>
      <div class="control-info-wrapper">
        <slot name="control-info" />
      </div>
    </div>

    <!-- 連珠盤セクション（中央 8×7）-->
    <div
      id="board-anchor"
      ref="boardFrameRef"
      class="board-section-wrapper"
      tabindex="0"
      role="application"
      aria-label="連珠盤"
      style="anchor-name: --board-area"
    >
      <slot
        name="board"
        :board-size="boardSize"
      />
    </div>

    <!-- 説明・コントロール部（右側 4×7）-->
    <div class="info-section-slot">
      <slot name="info" />
    </div>

    <!-- セリフ部（下段全幅、中央寄せ）-->
    <div class="dialog-section-slot">
      <slot name="dialog" />
    </div>
  </div>
</template>

<style scoped>
.game-player-layout {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 4fr 8fr 4fr;
  grid-template-rows: 7fr 2fr;
  padding: var(--size-14);
  gap: var(--size-14);
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
}

.control-section-slot {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--size-12);
  overflow: hidden;
  container-type: inline-size;
}

.control-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: var(--size-8);
}

.board-section-wrapper {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  min-height: 0;
  position: relative;
  outline-offset: var(--size-2);
}

.board-section-wrapper:focus-visible {
  outline: var(--size-2) solid var(--color-primary);
  border-radius: var(--size-4);
}

.info-section-slot {
  grid-column: 3;
  grid-row: 1;
  overflow-y: auto;
}

.dialog-section-slot {
  grid-column: 1 / -1;
  grid-row: 2;
  display: flex;
  justify-content: center;
  min-height: 0;
}

/* 盤面拡大モード */
.game-player-layout.large-board {
  grid-template-columns: 2fr 9fr 5fr;
  grid-template-rows: 1fr;
}

.large-board .control-info-wrapper {
  display: none;
}

.large-board .dialog-section-slot {
  display: none;
}
</style>
