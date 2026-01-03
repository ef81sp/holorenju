import { computed, type ComputedRef } from "vue";

export interface Position {
  row: number;
  col: number;
}

export function useRenjuBoardLayout(stageSize: ComputedRef<number>): {
  BOARD_SIZE: number;
  STAGE_WIDTH: ComputedRef<number>;
  STAGE_HEIGHT: ComputedRef<number>;
  CELL_SIZE: ComputedRef<number>;
  PADDING: ComputedRef<number>;
  STONE_RADIUS: ComputedRef<number>;
  positionToPixels: (row: number, col: number) => { x: number; y: number };
  pixelsToPosition: (x: number, y: number) => Position | null;
} {
  // 定数
  const BOARD_SIZE = 15;
  const STONE_RADIUS_RATIO = 0.45;

  // 計算されたプロパティ
  const STAGE_WIDTH = computed(() => stageSize.value);
  const STAGE_HEIGHT = computed(() => stageSize.value);

  // 盤面は15×15なので、セル間隔は14。上下左右のパディングを含めに16で割る
  const CELL_SIZE = computed(() => STAGE_WIDTH.value / 16);

  // 盤面を中央に配置するようにパディングを計算（上下左右対称）
  const PADDING = computed(() => {
    const width = STAGE_WIDTH.value;
    const cellSize = CELL_SIZE.value;
    return (width - (BOARD_SIZE - 1) * cellSize) / 2;
  });

  const STONE_RADIUS = computed(() => CELL_SIZE.value * STONE_RADIUS_RATIO);

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

    if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
      return { col, row };
    }

    return null;
  };

  return {
    BOARD_SIZE,
    STAGE_WIDTH,
    STAGE_HEIGHT,
    CELL_SIZE,
    PADDING,
    STONE_RADIUS,
    positionToPixels,
    pixelsToPosition,
  };
}
