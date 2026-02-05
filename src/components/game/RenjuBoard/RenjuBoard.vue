<script setup lang="ts">
import type { BoardState, Position, StoneColor } from "@/types/game";
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useBoardStore, type Mark, type Line } from "@/stores/boardStore";
import { useScenarioAnimationStore } from "@/stores/scenarioAnimationStore";
import { useRenjuBoardLayout } from "./composables/useRenjuBoardLayout";
import { useRenjuBoardInteraction } from "./composables/useRenjuBoardInteraction";
import { useRenjuBoardAnimation } from "./composables/useRenjuBoardAnimation";
import {
  generateGridLines,
  generateCursorCorners,
  generateCoordinateLabels,
  STAR_POINTS,
} from "./logic/boardRenderUtils";
import { BOARD_COLORS } from "@/constants/colors";

// Props
interface Props {
  boardState?: BoardState;
  disabled?: boolean;
  stageSize?: number;
  allowOverwrite?: boolean;
  cursorPosition?: Position;
  marks?: Mark[];
  lines?: Line[];
  playerColor?: "black" | "white";
}

const props = withDefaults(defineProps<Props>(), {
  boardState: () =>
    new Array(15).fill(null).map(() => new Array(15).fill(null)),
  disabled: false,
  stageSize: 640,
  allowOverwrite: false,
  cursorPosition: undefined,
  marks: undefined,
  lines: undefined,
  playerColor: "black",
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
const animationStore = useScenarioAnimationStore();

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

// シナリオ用のマーク・ライン（Props優先、なければboardStoreから）
const scenarioMarks = computed(() => props.marks ?? boardStore.marks);
const scenarioLines = computed(() => props.lines ?? boardStore.lines);

// マークの中心位置を計算（スケールアニメーションの原点として使用）
const getMarkCenter = (mark: Mark): { x: number; y: number } => {
  if (mark.positions.length === 0) {
    return { x: 0, y: 0 };
  }
  const sumX = mark.positions.reduce(
    (sum, pos) => sum + layout.positionToPixels(pos.row, pos.col).x,
    0,
  );
  const sumY = mark.positions.reduce(
    (sum, pos) => sum + layout.positionToPixels(pos.row, pos.col).y,
    0,
  );
  return {
    x: sumX / mark.positions.length,
    y: sumY / mark.positions.length,
  };
};

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

const coordinateLabels = computed(() =>
  generateCoordinateLabels(
    layout.BOARD_SIZE,
    layout.CELL_SIZE.value,
    layout.PADDING.value,
  ),
);

// ライフサイクル
onMounted(() => {
  // シナリオ用: 石アニメーションコールバック
  animationStore.setOnStoneAnimateCallback(async (position: Position) => {
    await animation.animateStone(position);
  });

  // シナリオ用: マークアニメーションコールバック
  animationStore.setOnMarkAnimateCallback(async (mark: Mark) => {
    await animation.animateMark(mark);
  });

  // シナリオ用: ラインアニメーションコールバック
  animationStore.setOnLineAnimateCallback(async (line: Line) => {
    await animation.animateLine(line);
  });

  // アニメーションキャンセルコールバック
  animationStore.setOnAnimationCancelCallback(() => {
    animation.finishAllAnimations();
  });
});

onBeforeUnmount(() => {
  animationStore.setOnStoneAnimateCallback(null);
  animationStore.setOnMarkAnimateCallback(null);
  animationStore.setOnLineAnimateCallback(null);
  animationStore.setOnAnimationCancelCallback(null);
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
            fill: BOARD_COLORS.background,
          }"
        />

        <!-- グリッド線 -->
        <v-line
          v-for="(line, index) in gridLines"
          :key="`line-${index}`"
          :config="line"
        />

        <!-- 座標ラベル（行: 1-15） -->
        <v-text
          v-for="(label, index) in coordinateLabels.rowLabels"
          :key="`row-label-${index}`"
          :config="{
            x: label.x - coordinateLabels.textBoxSize / 2,
            y: label.y - coordinateLabels.textBoxSize / 2,
            width: coordinateLabels.textBoxSize,
            height: coordinateLabels.textBoxSize,
            text: label.text,
            fontSize: coordinateLabels.fontSize,
            fontFamily: 'monospace',
            fill: BOARD_COLORS.label,
            align: 'center',
            verticalAlign: 'middle',
          }"
        />

        <!-- 座標ラベル（列: A-O） -->
        <v-text
          v-for="(label, index) in coordinateLabels.colLabels"
          :key="`col-label-${index}`"
          :config="{
            x: label.x - coordinateLabels.textBoxSize / 2,
            y: label.y - coordinateLabels.textBoxSize / 2,
            width: coordinateLabels.textBoxSize,
            height: coordinateLabels.textBoxSize,
            text: label.text,
            fontSize: coordinateLabels.fontSize,
            fontFamily: 'monospace',
            fill: BOARD_COLORS.label,
            align: 'center',
            verticalAlign: 'middle',
          }"
        />

        <!-- 星 -->
        <v-circle
          v-for="(star, index) in STAR_POINTS"
          :key="`star-${index}`"
          :config="{
            x: layout.positionToPixels(star.row, star.col).x,
            y: layout.positionToPixels(star.row, star.col).y,
            radius: 4,
            fill: BOARD_COLORS.starPoint,
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
            fill:
              stone.color === 'black'
                ? BOARD_COLORS.stoneBlack
                : BOARD_COLORS.stoneWhite,
            stroke:
              stone.color === 'white'
                ? BOARD_COLORS.stoneWhiteStroke
                : undefined,
            strokeWidth: stone.color === 'white' ? 1 : 0,
          }"
        />

        <!-- シナリオ用の石（boardStore.stonesFrom） -->
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
            fill:
              stone.color === 'black'
                ? BOARD_COLORS.stoneBlack
                : BOARD_COLORS.stoneWhite,
            stroke:
              stone.color === 'white'
                ? BOARD_COLORS.stoneWhiteStroke
                : undefined,
            strokeWidth: stone.color === 'white' ? 1 : 0,
            opacity: animationStore.isAnimating(stone.id) ? 0 : 1,
            scaleX: animationStore.isAnimating(stone.id) ? 0.8 : 1,
            scaleY: animationStore.isAnimating(stone.id) ? 0.8 : 1,
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
            fill:
              props.playerColor === 'black'
                ? BOARD_COLORS.stoneBlack
                : BOARD_COLORS.stoneWhite,
            stroke:
              props.playerColor === 'white'
                ? BOARD_COLORS.stoneWhiteStroke
                : undefined,
            strokeWidth: props.playerColor === 'white' ? 2 : 0,
            opacity: 0.4,
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
                ? BOARD_COLORS.stoneBlack
                : BOARD_COLORS.stoneWhite,
            stroke: BOARD_COLORS.previewStroke,
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
          v-for="line in scenarioLines"
          :key="line.id"
          :ref="
            (el: unknown) => {
              if (el) {
                animation.lineRefs[line.id] = el;
              }
            }
          "
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
            stroke: BOARD_COLORS.markAccent,
            strokeWidth: 3,
            dash: line.style === 'dashed' ? [10, 5] : undefined,
            opacity: animationStore.isAnimating(line.id) ? 0 : 1,
          }"
        />

        <!-- Marks -->
        <v-group
          v-for="mark in scenarioMarks"
          :key="mark.id"
          :ref="
            (el: unknown) => {
              if (el) {
                animation.markRefs[mark.id] = el;
              }
            }
          "
          :config="{
            x: getMarkCenter(mark).x,
            y: getMarkCenter(mark).y,
            offsetX: getMarkCenter(mark).x,
            offsetY: getMarkCenter(mark).y,
            opacity: animationStore.isAnimating(mark.id) ? 0 : 1,
            scaleX: animationStore.isAnimating(mark.id) ? 0.6 : 1,
            scaleY: animationStore.isAnimating(mark.id) ? 0.6 : 1,
          }"
        >
          <template
            v-for="(pos, posIndex) in mark.positions"
            :key="`mark-${mark.id}-pos-${posIndex}`"
          >
            <!-- Circle mark -->
            <v-circle
              v-if="mark.markType === 'circle'"
              :config="{
                x: layout.positionToPixels(pos.row, pos.col).x,
                y: layout.positionToPixels(pos.row, pos.col).y,
                radius: layout.STONE_RADIUS.value,
                stroke: BOARD_COLORS.markAccent,
                fill: BOARD_COLORS.markFill,
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
                  stroke: BOARD_COLORS.markAccent,
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
                  stroke: BOARD_COLORS.markAccent,
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
                stroke: BOARD_COLORS.markAccent,
                strokeWidth: 3,
                pointerLength: 10,
                pointerWidth: 10,
                pointerAtBeginning: false,
                pointerAtEnding: true,
              }"
            />
          </template>
        </v-group>
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
