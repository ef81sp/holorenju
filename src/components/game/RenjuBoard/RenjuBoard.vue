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

// Mark/Line types
interface BoardMark {
  positions: Position[];
  markType: "circle" | "cross" | "arrow";
  label?: string;
}

interface BoardLine {
  fromPosition: Position;
  toPosition: Position;
  style?: "solid" | "dashed";
}

// Props
interface Props {
  boardState?: BoardState;
  disabled?: boolean;
  stageSize?: number;
  allowOverwrite?: boolean;
  cursorPosition?: Position;
  marks?: BoardMark[];
  lines?: BoardLine[];
  dialogueIndex?: number; // ダイアログインデックス（Mark/Line表示用）
}

const props = withDefaults(defineProps<Props>(), {
  boardState: () =>
    new Array(15).fill(null).map(() => new Array(15).fill(null)),
  disabled: false,
  stageSize: 640,
  allowOverwrite: false,
  cursorPosition: undefined,
  marks: () => [],
  lines: () => [],
  dialogueIndex: 0,
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

// 配置済みの石を計算（props.boardStateから）
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

// シナリオ用の石（boardStore.stonesから）
const scenarioStones = computed(() => boardStore.stones);

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
  // シナリオ用: 石追加時のアニメーションコールバック
  boardStore.setOnStoneAddedCallback(async (position: Position) => {
    await animation.animateStone(position);
  });

  // アニメーションキャンセルコールバック
  boardStore.setOnAnimationCancelCallback(() => {
    animation.finishAllAnimations();
  });
});

onBeforeUnmount(() => {
  boardStore.setOnStoneAddedCallback(null);
  boardStore.setOnAnimationCancelCallback(null);
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

        <!-- 配置済みの石（props.boardStateから） -->
        <v-circle
          v-for="stone in placedStones"
          :key="`stone-${stone.row}-${stone.col}`"
          :config="{
            x: layout.positionToPixels(stone.row, stone.col).x,
            y: layout.positionToPixels(stone.row, stone.col).y,
            radius: layout.STONE_RADIUS.value,
            fill: stone.color === 'black' ? '#000' : '#fff',
            stroke: stone.color === 'white' ? '#000' : undefined,
            strokeWidth: stone.color === 'white' ? 1 : 0,
          }"
        />

        <!-- シナリオ用の石（boardStore.stonesから） -->
        <v-circle
          v-for="stone in scenarioStones"
          :key="stone.id"
          :ref="
            (el: unknown) => {
              const stoneKey = `${stone.position.row}-${stone.position.col}`;
              if (el) {
                animation.stoneRefs[stoneKey] = el;
              }
            }
          "
          :config="{
            x: layout.positionToPixels(stone.position.row, stone.position.col)
              .x,
            y: layout.positionToPixels(stone.position.row, stone.position.col)
              .y,
            radius: layout.STONE_RADIUS.value,
            fill: stone.color === 'black' ? '#000' : '#fff',
            stroke: stone.color === 'white' ? '#000' : undefined,
            strokeWidth: stone.color === 'white' ? 1 : 0,
            opacity: stone.shouldAnimate ? 0.5 : 1,
            scaleX: stone.shouldAnimate ? 0.8 : 1,
            scaleY: stone.shouldAnimate ? 0.8 : 1,
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

        <!-- Lines -->
        <v-line
          v-for="(line, index) in props.lines"
          :key="`line-${props.dialogueIndex}-${index}`"
          :config="{
            points: [
              layout.positionToPixels(
                line.fromPosition.row,
                line.fromPosition.col,
              ).x,
              layout.positionToPixels(
                line.fromPosition.row,
                line.fromPosition.col,
              ).y,
              layout.positionToPixels(line.toPosition.row, line.toPosition.col)
                .x,
              layout.positionToPixels(line.toPosition.row, line.toPosition.col)
                .y,
            ],
            stroke: '#FF0000',
            strokeWidth: 3,
            dash: line.style === 'dashed' ? [10, 5] : undefined,
          }"
        />

        <!-- Marks -->
        <template
          v-for="(mark, markIndex) in props.marks"
          :key="`mark-${markIndex}`"
        >
          <template
            v-for="(pos, posIndex) in mark.positions"
            :key="`mark-${markIndex}-pos-${posIndex}`"
          >
            <!-- Circle mark -->
            <v-circle
              v-if="mark.markType === 'circle'"
              :config="{
                x: layout.positionToPixels(pos.row, pos.col).x,
                y: layout.positionToPixels(pos.row, pos.col).y,
                radius: layout.STONE_RADIUS.value * 0.7,
                stroke: '#FF0000',
                strokeWidth: 3,
              }"
            />
            <!-- Cross mark -->
            <template v-else-if="mark.markType === 'cross'">
              <v-line
                :config="{
                  points: [
                    layout.positionToPixels(pos.row, pos.col).x -
                      layout.STONE_RADIUS.value * 0.5,
                    layout.positionToPixels(pos.row, pos.col).y -
                      layout.STONE_RADIUS.value * 0.5,
                    layout.positionToPixels(pos.row, pos.col).x +
                      layout.STONE_RADIUS.value * 0.5,
                    layout.positionToPixels(pos.row, pos.col).y +
                      layout.STONE_RADIUS.value * 0.5,
                  ],
                  stroke: '#FF0000',
                  strokeWidth: 3,
                }"
              />
              <v-line
                :config="{
                  points: [
                    layout.positionToPixels(pos.row, pos.col).x +
                      layout.STONE_RADIUS.value * 0.5,
                    layout.positionToPixels(pos.row, pos.col).y -
                      layout.STONE_RADIUS.value * 0.5,
                    layout.positionToPixels(pos.row, pos.col).x -
                      layout.STONE_RADIUS.value * 0.5,
                    layout.positionToPixels(pos.row, pos.col).y +
                      layout.STONE_RADIUS.value * 0.5,
                  ],
                  stroke: '#FF0000',
                  strokeWidth: 3,
                }"
              />
            </template>
            <!-- Arrow mark -->
            <v-line
              v-else-if="mark.markType === 'arrow'"
              :config="{
                points: [
                  layout.positionToPixels(pos.row, pos.col).x,
                  layout.positionToPixels(pos.row, pos.col).y -
                    layout.STONE_RADIUS.value * 0.8,
                  layout.positionToPixels(pos.row, pos.col).x,
                  layout.positionToPixels(pos.row, pos.col).y +
                    layout.STONE_RADIUS.value * 0.8,
                ],
                stroke: '#FF0000',
                strokeWidth: 3,
                pointerLength: 10,
                pointerWidth: 10,
                pointerAtBeginning: false,
                pointerAtEnding: true,
              }"
            />
          </template>
        </template>
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
