// 座標変換ユーティリティ
// 内部座標(0-14) ↔ 表示座標(1-15, A-O) の相互変換
//
// 盤面表示: 行は上から15→1、列は左からA→O
// 内部座標: row 0-14 (0が上), col 0-14 (0が左)

const COLUMN_LABELS = "ABCDEFGHIJKLMNO";

/**
 * 内部row(0-14)を表示row(1-15)に変換
 * 0→15, 7→8, 14→1
 */
export const internalRowToDisplay = (row: number): number => 15 - row;

/**
 * 表示row(1-15)を内部row(0-14)に変換
 * 15→0, 8→7, 1→14
 */
export const displayRowToInternal = (displayRow: number): number =>
  15 - displayRow;

/**
 * 内部col(0-14)を表示col(A-O)に変換
 * 0→'A', 7→'H', 14→'O'
 */
export const internalColToDisplay = (col: number): string =>
  COLUMN_LABELS[col] || "A";

/**
 * 表示col(A-O)を内部col(0-14)に変換
 * 'A'→0, 'H'→7, 'O'→14
 */
export const displayColToInternal = (displayCol: string): number => {
  const index = COLUMN_LABELS.indexOf(displayCol.toUpperCase());
  return index >= 0 ? index : 0;
};

/**
 * 位置入力のバリデーション（0-14の範囲に制限）
 */
export const clampPosition = (value: number): number =>
  Math.max(0, Math.min(14, value));

/**
 * 表示行のバリデーション（1-15の範囲に制限）
 */
export const clampDisplayRow = (value: number): number =>
  Math.max(1, Math.min(15, value));

/**
 * 列ラベルの配列（A-O）
 */
export const COLUMN_OPTIONS = COLUMN_LABELS.split("");
