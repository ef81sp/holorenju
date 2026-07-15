/**
 * 盤面の D4 対称変換（恒等・回転3・鏡映4）と canonical key。
 *
 * opening-trap-mining-2026-07-16.md §6 の定義:
 * 盤面の225セル文字列 + 手番を、盤の8対称変換（D4 群: 恒等・回転3・鏡映4）
 * すべてに適用した際の辞書順最小値を canonical key とする。
 * dedup は global-D4（珠型ごとの局所正規化ではなく全体で最小値を取る）。
 */
import type { BoardState, Position, StoneColor } from "@/types/game";

import { BOARD_SIZE } from "@/constants";

const N = BOARD_SIZE;

/** 座標変換関数（変換前の (row, col) → 変換後の (row, col)）。 */
export type CoordTransform = (row: number, col: number) => Position;

const identity: CoordTransform = (row, col) => ({ row, col });
const rotate90: CoordTransform = (row, col) => ({ row: col, col: N - 1 - row });
const rotate180: CoordTransform = (row, col) => ({
  row: N - 1 - row,
  col: N - 1 - col,
});
const rotate270: CoordTransform = (row, col) => ({
  row: N - 1 - col,
  col: row,
});
const flipHorizontal: CoordTransform = (row, col) => ({
  row,
  col: N - 1 - col,
});
const flipVertical: CoordTransform = (row, col) => ({
  row: N - 1 - row,
  col,
});
const flipDiagonal: CoordTransform = (row, col) => ({ row: col, col: row });
const flipAntiDiagonal: CoordTransform = (row, col) => ({
  row: N - 1 - col,
  col: N - 1 - row,
});

/** D4 群の8変換（正方形の対称群: 恒等・回転3種・鏡映4種）。 */
export const D4_TRANSFORMS: { name: string; transform: CoordTransform }[] = [
  { name: "identity", transform: identity },
  { name: "rotate90", transform: rotate90 },
  { name: "rotate180", transform: rotate180 },
  { name: "rotate270", transform: rotate270 },
  { name: "flipHorizontal", transform: flipHorizontal },
  { name: "flipVertical", transform: flipVertical },
  { name: "flipDiagonal", transform: flipDiagonal },
  { name: "flipAntiDiagonal", transform: flipAntiDiagonal },
];

/** 盤面全体に座標変換を適用した新しい盤面を返す（元の盤面は変更しない）。 */
export function transformBoard(
  board: BoardState,
  transform: CoordTransform,
): BoardState {
  const newBoard: BoardState = Array.from({ length: N }, () =>
    new Array<StoneColor>(N).fill(null),
  );
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const cell = board[row]?.[col] ?? null;
      if (cell === null) {
        continue;
      }
      const dest = transform(row, col);
      const destRow = newBoard[dest.row];
      if (destRow) {
        destRow[dest.col] = cell;
      }
    }
  }
  return newBoard;
}

function cellChar(cell: StoneColor): string {
  if (cell === "black") {
    return "B";
  }
  if (cell === "white") {
    return "W";
  }
  return ".";
}

/** 盤面を225セルの文字列（行優先、'.'=空/'B'=黒/'W'=白）に変換する。 */
export function boardToString(board: BoardState): string {
  let s = "";
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      s += cellChar(board[row]?.[col] ?? null);
    }
  }
  return s;
}

/**
 * canonical key を計算する。
 * 盤の8対称変換すべてに適用した225セル文字列+手番のうち、辞書順最小値を返す。
 */
export function canonicalKey(
  board: BoardState,
  sideToMove: "black" | "white",
): string {
  let best: string | null = null;
  for (const { transform } of D4_TRANSFORMS) {
    const transformed = transformBoard(board, transform);
    const key = `${boardToString(transformed)}|${sideToMove}`;
    if (best === null || key < best) {
      best = key;
    }
  }
  // D4_TRANSFORMS は非空のため best は必ず設定される
  return best as string;
}
