<script setup lang="ts">
import type {
  BoardState,
  Position,
  PreviewStone,
  StoneColor,
} from "@/types/game";
import { ref, computed } from "vue";

// Props
interface Props {
  boardState?: BoardState;
  disabled?: boolean;
  stageSize?: number;
}

const props = withDefaults(defineProps<Props>(), {
  boardState: () =>
    new Array(15).fill(null).map(() => new Array(15).fill(null)),
  disabled: false,
  stageSize: 640,
});

// Emits
const emit = defineEmits<{
  placeStone: [position: Position];
}>();

// 定数
const BOARD_SIZE = 15;
const MARGIN_MULTIPLIER = 2;
const OFFSET_ONE = 1;
const EFFECTIVE_CELLS = BOARD_SIZE - OFFSET_ONE + MARGIN_MULTIPLIER;
const STONE_RADIUS_RATIO = 0.45;
const GRID_STROKE_WIDTH = 1;
const LOWER_BOUND = 0;

// Refs
const stageSize = computed(() => {
  const value = props.stageSize || 640;
  console.log("[RenjuBoard] stageSize computed:", {
    propsStageSize: props.stageSize,
    computedValue: value,
  });
  return value;
});

// 動的に計算されるセルサイズ
const CELL_SIZE = computed(() => stageSize.value / EFFECTIVE_CELLS);

const PADDING = computed(() => CELL_SIZE.value);

const STAGE_WIDTH = computed(() => stageSize.value);

const STAGE_HEIGHT = computed(() => stageSize.value);

const STONE_RADIUS = computed(() => CELL_SIZE.value * STONE_RADIUS_RATIO);

// Stage configuration
const stageConfig = computed(() => {
  const config = {
    width: STAGE_WIDTH.value,
    height: STAGE_HEIGHT.value,
  };
  console.log("[RenjuBoard] stageConfig computed:", {
    stageSize: stageSize.value,
    STAGE_WIDTH: STAGE_WIDTH.value,
    STAGE_HEIGHT: STAGE_HEIGHT.value,
    config,
  });
  return config;
});

// 状態
const previewStone = ref<PreviewStone | null>(null);
const hoveredPosition = ref<Position | null>(null);

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

// 盤面のグリッド線を生成
const generateGridLines = (): {
  points: number[];
  stroke: string;
  strokeWidth: number;
}[] => {
  const lines: { points: number[]; stroke: string; strokeWidth: number }[] = [];
  const currentCellSize = CELL_SIZE.value;
  const currentPadding = PADDING.value;

  for (let i = LOWER_BOUND; i < BOARD_SIZE; i += 1) {
    // 横線
    lines.push({
      points: [
        currentPadding,
        currentPadding + i * currentCellSize,
        currentPadding + (BOARD_SIZE - OFFSET_ONE) * currentCellSize,
        currentPadding + i * currentCellSize,
      ],
      stroke: "#000",
      strokeWidth: GRID_STROKE_WIDTH,
    });

    // 縦線
    lines.push({
      points: [
        currentPadding + i * currentCellSize,
        currentPadding,
        currentPadding + i * currentCellSize,
        currentPadding + (BOARD_SIZE - OFFSET_ONE) * currentCellSize,
      ],
      stroke: "#000",
      strokeWidth: GRID_STROKE_WIDTH,
    });
  }

  return lines;
};

// 星（天元・小目）の位置
const starPoints = [
  { col: 3, row: 3 },
  { col: 11, row: 3 },
  { col: 7, row: 7 },
  { col: 3, row: 11 },
  { col: 11, row: 11 },
];

// 座標をピクセル位置に変換
const positionToPixels = (
  row: number,
  col: number,
): { x: number; y: number } => ({
  x: PADDING.value + col * CELL_SIZE.value,
  y: PADDING.value + row * CELL_SIZE.value,
});

// ピクセル位置を座標に変換
const pixelsToPosition = (x: number, y: number): Position | null => {
  const col = Math.round((x - PADDING.value) / CELL_SIZE.value);
  const row = Math.round((y - PADDING.value) / CELL_SIZE.value);

  if (
    row >= LOWER_BOUND &&
    row < BOARD_SIZE &&
    col >= LOWER_BOUND &&
    col < BOARD_SIZE
  ) {
    return { col, row };
  }

  return null;
};

// クリックハンドラー
const handleStageClick = (e: {
  target: {
    getStage: () => {
      getPointerPosition: () => { x: number; y: number } | null;
    };
  };
}): void => {
  if (props.disabled) {
    return;
  }

  const stage = e.target.getStage();
  const pointerPosition = stage.getPointerPosition();

  if (!pointerPosition) {
    return;
  }

  const position = pixelsToPosition(pointerPosition.x, pointerPosition.y);

  if (!position) {
    return;
  }

  // すでに石が置かれている場所はクリック不可
  if (props.boardState[position.row]?.[position.col]) {
    return;
  }

  // 仮指定中の石と同じ位置をクリックした場合は確定
  if (
    previewStone.value &&
    previewStone.value.position.row === position.row &&
    previewStone.value.position.col === position.col
  ) {
    emit("placeStone", position);
    previewStone.value = null;
  } else {
    // 新しい位置を仮指定
    previewStone.value = {
      color: "black",
      position, // MVPでは黒石のみ
    };
  }
};

// マウスムーブハンドラー
const handleStageMouseMove = (e: {
  target: {
    getStage: () => {
      getPointerPosition: () => { x: number; y: number } | null;
    };
  };
}): void => {
  if (props.disabled) {
    return;
  }

  const stage = e.target.getStage();
  const pointerPosition = stage.getPointerPosition();

  if (!pointerPosition) {
    hoveredPosition.value = null;
    return;
  }

  const position = pixelsToPosition(pointerPosition.x, pointerPosition.y);

  if (position && !props.boardState[position.row]?.[position.col]) {
    hoveredPosition.value = position;
  } else {
    hoveredPosition.value = null;
  }
};

// マウスリーブハンドラー
const handleStageMouseLeave = (): void => {
  hoveredPosition.value = null;
};
</script>

<template>
  <div class="renju-board">
    <v-stage
      :config="stageConfig"
      @mousedown="handleStageClick"
      @mousemove="handleStageMouseMove"
      @mouseleave="handleStageMouseLeave"
    >
      <v-layer>
        <!-- 背景 -->
        <v-rect
          :config="{
            x: 0,
            y: 0,
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            fill: '#DEB887',
          }"
        />

        <!-- グリッド線 -->
        <v-line
          v-for="(line, index) in generateGridLines()"
          :key="`line-${index}`"
          :config="line"
        />

        <!-- 星 -->
        <v-circle
          v-for="(star, index) in starPoints"
          :key="`star-${index}`"
          :config="{
            x: positionToPixels(star.row, star.col).x,
            y: positionToPixels(star.row, star.col).y,
            radius: 4,
            fill: '#000',
          }"
        />

        <!-- 配置済みの石 -->
        <v-circle
          v-for="(stone, index) in placedStones"
          :key="`stone-${index}`"
          :config="{
            x: positionToPixels(stone.row, stone.col).x,
            y: positionToPixels(stone.row, stone.col).y,
            radius: STONE_RADIUS,
            fill: stone.color === 'black' ? '#000' : '#fff',
            stroke: stone.color === 'white' ? '#000' : undefined,
            strokeWidth: stone.color === 'white' ? 1 : 0,
          }"
        />

        <!-- ホバー中の位置表示 -->
        <v-circle
          v-if="hoveredPosition && !previewStone"
          :config="{
            x: positionToPixels(hoveredPosition.row, hoveredPosition.col).x,
            y: positionToPixels(hoveredPosition.row, hoveredPosition.col).y,
            radius: STONE_RADIUS,
            fill: '#000',
            opacity: 0.2,
          }"
        />

        <!-- 仮指定中の石 -->
        <v-circle
          v-if="previewStone"
          :config="{
            x: positionToPixels(
              previewStone.position.row,
              previewStone.position.col,
            ).x,
            y: positionToPixels(
              previewStone.position.row,
              previewStone.position.col,
            ).y,
            radius: STONE_RADIUS,
            fill: previewStone.color === 'black' ? '#000' : '#fff',
            stroke: '#FFD700',
            strokeWidth: 3,
            opacity: 0.7,
          }"
        />
      </v-layer>
    </v-stage>
  </div>
</template>

<style scoped>
.renju-board {
  display: block;
  width: 100%;
  height: 100%;
  aspect-ratio: 1;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
}

.renju-board.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
