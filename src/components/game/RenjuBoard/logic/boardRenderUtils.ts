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

// カーソルの四隅を描画（括弧型フレーム）
export function generateCursorCorners(
  cursorPosition: Position | undefined,
  positionToPixels: (row: number, col: number) => { x: number; y: number },
  CELL_SIZE: number,
): { points: number[]; stroke: string; strokeWidth: number }[] {
  if (!cursorPosition) {
    return [];
  }

  const { row, col } = cursorPosition;
  const { x, y } = positionToPixels(row, col);

  // セルの四隅を基準に、括弧型フレームを描画
  const halfCell = CELL_SIZE / 2;
  const cornerPadding = CELL_SIZE * 0.1; // セルの四隅からのpadding
  const cornerLength = CELL_SIZE * 0.35; // コーナー線の長さ
  const cornerWidth = 3;
  const color = "#37abdf";

  // セルの四隅座標（paddingを適用）
  const left = x - halfCell - cornerPadding;
  const right = x + halfCell + cornerPadding;
  const top = y - halfCell - cornerPadding;
  const bottom = y + halfCell + cornerPadding;

  // 左上コーナー（┌）
  const topLeft1 = [left, top, left + cornerLength, top]; // 水平線
  const topLeft2 = [left, top, left, top + cornerLength]; // 垂直線

  // 右上コーナー（┐）
  const topRight1 = [right - cornerLength, top, right, top]; // 水平線
  const topRight2 = [right, top, right, top + cornerLength]; // 垂直線

  // 左下コーナー（└）
  const bottomLeft1 = [left, bottom, left + cornerLength, bottom]; // 水平線
  const bottomLeft2 = [left, bottom - cornerLength, left, bottom]; // 垂直線

  // 右下コーナー（┘）
  const bottomRight1 = [right - cornerLength, bottom, right, bottom]; // 水平線
  const bottomRight2 = [right, bottom - cornerLength, right, bottom]; // 垂直線

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
