<script setup lang="ts">
import type { BoardState, Position, StoneColor } from "@/types/game";
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useBoardStore } from "@/stores/boardStore";
import { useRenjuBoardLayout } from "./composables/useRenjuBoardLayout";
import { useRenjuBoardInteraction } from "./composables/useRenjuBoardInteraction";
import { useRenjuBoardAnimation } from "./composables/useRenjuBoardAnimation";
import {
  generateGridLines,
  generateCursorCorners,
  STAR_POINTS,
} from "./logic/boardRenderUtils";

// Props
interface Props {
  boardState?: BoardState;
  disabled?: boolean;
  stageSize?: number;
  allowOverwrite?: boolean;
  cursorPosition?: Position;
}

const props = withDefaults(defineProps<Props>(), {
  boardState: () =>
    new Array(15).fill(null).map(() => new Array(15).fill(null)),
  disabled: false,
  stageSize: 640,
  allowOverwrite: false,
  cursorPosition: undefined,
});

// Emits
const emit = defineEmits<{
  placeStone: [position: Position];
  hoverCell: [position: Position | null];
}>();

// 定数
const GRID_STROKE_WIDTH = 1;

// ストア
const boardStore = useBoardStore();

// Composables
const stageSize = computed(() => props.stageSize || 640);
const layout = useRenjuBoardLayout(stageSize);
const interaction = useRenjuBoardInteraction(
  props,
  layout,
  (event: string, ...args: unknown[]) => {
    if (event === "placeStone") {
      emit("placeStone", args[0] as Position);
    } else if (event === "hoverCell") {
      emit("hoverCell", args[0] as Position | null);
    }
  },
);
const animation = useRenjuBoardAnimation(layout);

// 配置済みの石を計算
interface PlacedStone {
  row: number;
  col: number;
  color: StoneColor;
}

const placedStones = computed<PlacedStone[]>(() => {
  const stones: PlacedStone[] = [];
  if (!props.boardState) {
    return stones;
  }

  for (let row = 0; row < props.boardState.length; row += 1) {
    const rowData = props.boardState[row];
    if (!rowData) {
      continue;
    }

    for (let col = 0; col < rowData.length; col += 1) {
      const cell = rowData[col];
      if (cell) {
        stones.push({ row, col, color: cell });
      }
    }
  }

  return stones;
});

// Stage configuration
const stageConfig = computed(() => ({
  width: layout.STAGE_WIDTH.value,
  height: layout.STAGE_HEIGHT.value,
}));

// 描画データ
const gridLines = computed(() =>
  generateGridLines(
    layout.BOARD_SIZE,
    layout.CELL_SIZE.value,
    layout.PADDING.value,
    GRID_STROKE_WIDTH,
  ),
);

const cursorCorners = computed(() =>
  props.disabled
    ? null
    : generateCursorCorners(
        props.cursorPosition,
        layout.positionToPixels,
        layout.CELL_SIZE.value,
      ),
);

// ライフサイクル
onMounted(() => {
  boardStore.setOnStonePlacedCallback(async (position: Position) => {
    const stoneKey = `${position.row}-${position.col}`;
    await animation.animateLastPlacedStone(stoneKey, position);
  });
});

onBeforeUnmount(() => {
  boardStore.setOnStonePlacedCallback(null);
});
</script>

<template>
  <div class="renju-board">
    <v-stage
      :config="stageConfig"
      @mousedown="interaction.handleStageClick"
      @mousemove="interaction.handleStageMouseMove"
      @mouseleave="interaction.handleStageMouseLeave"
    >
      <v-layer>
        <!-- 背景 -->
        <v-rect
          :config="{
            x: 0,
            y: 0,
            width: layout.STAGE_WIDTH.value,
            height: layout.STAGE_HEIGHT.value,
            fill: '#DEB887',
          }"
        />

        <!-- グリッド線 -->
        <v-line
          v-for="(line, index) in gridLines"
          :key="`line-${index}`"
          :config="line"
        />

        <!-- 星 -->
        <v-circle
          v-for="(star, index) in STAR_POINTS"
          :key="`star-${index}`"
          :config="{
            x: layout.positionToPixels(star.row, star.col).x,
            y: layout.positionToPixels(star.row, star.col).y,
            radius: 4,
            fill: '#000',
          }"
        />

        <!-- 配置済みの石 -->
        <v-circle
          v-for="stone in placedStones"
          :key="`stone-${stone.row}-${stone.col}`"
          :ref="
            (el: unknown) => {
              const stoneKey = `${stone.row}-${stone.col}`;
              if (el) {
                animation.stoneRefs[stoneKey] = el;
              }
            }
          "
          :config="{
            x: layout.positionToPixels(stone.row, stone.col).x,
            y: layout.positionToPixels(stone.row, stone.col).y,
            radius: layout.STONE_RADIUS.value,
            fill: stone.color === 'black' ? '#000' : '#fff',
            stroke: stone.color === 'white' ? '#000' : undefined,
            strokeWidth: stone.color === 'white' ? 1 : 0,
          }"
        />

        <!-- ホバー中の位置表示 -->
        <v-circle
          v-if="
            interaction.hoveredPosition.value && !interaction.previewStone.value
          "
          :config="{
            x: layout.positionToPixels(
              interaction.hoveredPosition.value.row,
              interaction.hoveredPosition.value.col,
            ).x,
            y: layout.positionToPixels(
              interaction.hoveredPosition.value.row,
              interaction.hoveredPosition.value.col,
            ).y,
            radius: layout.STONE_RADIUS.value,
            fill: '#000',
            opacity: 0.2,
          }"
        />

        <!-- 仮指定中の石 -->
        <v-circle
          v-if="interaction.previewStone.value"
          :config="{
            x: layout.positionToPixels(
              interaction.previewStone.value.position.row,
              interaction.previewStone.value.position.col,
            ).x,
            y: layout.positionToPixels(
              interaction.previewStone.value.position.row,
              interaction.previewStone.value.position.col,
            ).y,
            radius: layout.STONE_RADIUS.value,
            fill:
              interaction.previewStone.value.color === 'black'
                ? '#000'
                : '#fff',
            stroke: '#FFD700',
            strokeWidth: 3,
            opacity: 0.7,
          }"
        />

        <!-- キーボードカーソル表示 -->
        <v-line
          v-for="(line, index) in cursorCorners"
          :key="`cursor-corner-${index}`"
          :config="line"
        />
      </v-layer>
    </v-stage>
  </div>
</template>

<style scoped>
.renju-board {
  display: flex;
  justify-content: end;
  aspect-ratio: 1;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  cursor: pointer;
}

.renju-board.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
