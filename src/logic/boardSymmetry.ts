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
  return canonicalKeyWithTransform(board, sideToMove).key;
}

/**
 * canonicalKey を計算し、その値を達成した変換の名前（D4_TRANSFORMS の name）も返す。
 *
 * オープニングブックのルックアップ結果（canonical 空間の座標）を実盤座標へ
 * 逆写像する際に、どの変換で canonical 化されたかを知る必要があるための拡張 API
 * （opening-book-2026-07-16.md §2）。
 *
 * 自己対称局面（stabilizer が非自明）では複数の変換が同じ最小キーを達成し得るが、
 * D4_TRANSFORMS の先頭から探索して最初に見つかったものを返す（canonicalKey 本体と
 * 同じ tie-break: 厳密な `<` 比較で先着優先）。盤対称で戦略的に等価なため、
 * どれを選んでも逆写像の結果は安全（transformPosition/inverseTransformPosition の
 * ラウンドトリップテスト参照）。
 */
export function canonicalKeyWithTransform(
  board: BoardState,
  sideToMove: "black" | "white",
): { key: string; transformName: string } {
  let best: { key: string; transformName: string } | null = null;
  for (const { name, transform } of D4_TRANSFORMS) {
    const transformed = transformBoard(board, transform);
    const key = `${boardToString(transformed)}|${sideToMove}`;
    if (best === null || key < best.key) {
      best = { key, transformName: name };
    }
  }
  // D4_TRANSFORMS は非空のため best は必ず設定される
  return best as { key: string; transformName: string };
}

/** 各変換名の逆変換名（D4群は全要素が位数1か2、または回転90⇔270が互いの逆）。 */
const INVERSE_TRANSFORM_NAME: Record<string, string> = {
  identity: "identity",
  rotate90: "rotate270",
  rotate180: "rotate180",
  rotate270: "rotate90",
  flipHorizontal: "flipHorizontal",
  flipVertical: "flipVertical",
  flipDiagonal: "flipDiagonal",
  flipAntiDiagonal: "flipAntiDiagonal",
};

function findTransformByName(transformName: string): CoordTransform {
  const found = D4_TRANSFORMS.find((t) => t.name === transformName);
  if (!found) {
    throw new Error(`未知の変換名: ${transformName}`);
  }
  return found.transform;
}

/** 指定した名前の変換で座標を写像する（canonical 化と同じ向き）。 */
export function transformPosition(
  pos: Position,
  transformName: string,
): Position {
  return findTransformByName(transformName)(pos.row, pos.col);
}

/**
 * canonical 空間の座標を、指定した変換で canonical 化された局面から実盤座標へ
 * 逆写像する（opening-book-2026-07-16.md §2）。
 */
export function inverseTransformPosition(
  canonicalPos: Position,
  transformName: string,
): Position {
  const inverseName = INVERSE_TRANSFORM_NAME[transformName];
  if (!inverseName) {
    throw new Error(`未知の変換名: ${transformName}`);
  }
  return findTransformByName(inverseName)(canonicalPos.row, canonicalPos.col);
}
