import type { Position } from "@/types/game";

// グリッド線の生成
export function generateGridLines(
  BOARD_SIZE: number,
  CELL_SIZE: number,
  PADDING: number,
  GRID_STROKE_WIDTH: number,
): { points: number[]; stroke: string; strokeWidth: number }[] {
  const lines: { points: number[]; stroke: string; strokeWidth: number }[] = [];

  for (let i = 0; i < BOARD_SIZE; i += 1) {
    // 横線
    lines.push({
      points: [
        PADDING,
        PADDING + i * CELL_SIZE,
        PADDING + (BOARD_SIZE - 1) * CELL_SIZE,
        PADDING + i * CELL_SIZE,
      ],
      stroke: "#000",
      strokeWidth: GRID_STROKE_WIDTH,
    });

    // 縦線
    lines.push({
      points: [
        PADDING + i * CELL_SIZE,
        PADDING,
        PADDING + i * CELL_SIZE,
        PADDING + (BOARD_SIZE - 1) * CELL_SIZE,
      ],
      stroke: "#000",
      strokeWidth: GRID_STROKE_WIDTH,
    });
  }

  return lines;
}

// 星（天元・小目）の位置
export const STAR_POINTS: Position[] = [
  { col: 3, row: 3 },
  { col: 11, row: 3 },
  { col: 7, row: 7 },
  { col: 3, row: 11 },
  { col: 11, row: 11 },
];

// カーソルの四隅を描画
export function generateCursorCorners(
  cursorPosition: Position | undefined,
  positionToPixels: (row: number, col: number) => { x: number; y: number },
  CELL_SIZE: number,
  STONE_RADIUS: number,
): { points: number[]; stroke: string; strokeWidth: number }[] {
  if (!cursorPosition) {
    return [];
  }

  const { row, col } = cursorPosition;
  const { x, y } = positionToPixels(row, col);
  const cornerLength = CELL_SIZE * 0.25; // セルサイズの25%
  const cornerWidth = 2;
  const color = "#FF6B6B"; // 赤色

  // 左上コーナー
  const topLeft1 = [x - cornerLength, y - STONE_RADIUS, x, y - STONE_RADIUS];
  const topLeft2 = [x - STONE_RADIUS, y - cornerLength, x - STONE_RADIUS, y];

  // 右上コーナー
  const topRight1 = [
    x + STONE_RADIUS,
    y - STONE_RADIUS,
    x + cornerLength,
    y - STONE_RADIUS,
  ];
  const topRight2 = [x + STONE_RADIUS, y - cornerLength, x + STONE_RADIUS, y];

  // 左下コーナー
  const bottomLeft1 = [x - cornerLength, y + STONE_RADIUS, x, y + STONE_RADIUS];
  const bottomLeft2 = [x - STONE_RADIUS, y, x - STONE_RADIUS, y + cornerLength];

  // 右下コーナー
  const bottomRight1 = [
    x + STONE_RADIUS,
    y + STONE_RADIUS,
    x + cornerLength,
    y + STONE_RADIUS,
  ];
  const bottomRight2 = [
    x + STONE_RADIUS,
    y,
    x + STONE_RADIUS,
    y + cornerLength,
  ];

  return [
    { points: topLeft1, stroke: color, strokeWidth: cornerWidth },
    { points: topLeft2, stroke: color, strokeWidth: cornerWidth },
    { points: topRight1, stroke: color, strokeWidth: cornerWidth },
    { points: topRight2, stroke: color, strokeWidth: cornerWidth },
    { points: bottomLeft1, stroke: color, strokeWidth: cornerWidth },
    { points: bottomLeft2, stroke: color, strokeWidth: cornerWidth },
    { points: bottomRight1, stroke: color, strokeWidth: cornerWidth },
    { points: bottomRight2, stroke: color, strokeWidth: cornerWidth },
  ];
}
