/**
 * CPUライン解析ユーティリティ
 *
 * SSoT (Single Source of Truth) として連の解析に関する関数を提供
 */

import type { BoardState, Position } from "@/types/game";

import { isValidPosition } from "@/logic/renjuRules";

/**
 * ライン上の空点のうち、その方向で「埋めると五になる」点を列挙する
 *
 * 受け点（四を止める点）の SSoT。Zig 側 `threats.collectLineFivePoints` と対応する。
 *
 * 「跳び四のギャップを探して返す」方式（`findJumpGapPosition`）は、5 マス窓を
 * ラインの先頭から走査して最初のギャップを返すため、同一ライン上に
 * 「埋めると長連になるギャップ」と「埋めると五になる正当なギャップ」が
 * 併存すると前者を返してしまう（issue #115）。
 * 例: 8 行目 `G8 H8 _ J8 K8 L8 _ N8`（黒）で J8 に打ったとき、
 * I8 を埋めると G8..L8 の 6 連＝長連、M8 を埋めると J8..N8 の五。本物の受けは M8。
 *
 * そこでギャップを探すのではなく、ライン上（±5 マス）の空点を仮の着手点として
 * 「その方向で五になるか」を直接判定する。
 *
 * - 黒: ちょうど 5（6 以上は長連なので五ではない）
 * - 白: 5 以上（白に長連の制限は無い）
 *
 * 白を `>= 5` にしているのは意図的である。`renjuRules` の `checkFive` は白でも
 * `== 5` で判定しており、白の長連（6 連以上）を五と認めない（定義不一致・#125）。
 * 連珠ルール上は白の長連は勝ちなので、受け点の列挙ではルールに従って `>= 5` を採る。
 *
 * 方向限定である点が重要: `checkFive` は 4 方向すべてを見るため、
 * 別ラインの五点まで拾ってしまい「この四の受け」という意味からずれる。
 */
export function collectLineFivePoints(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): Position[] {
  const points: Position[] = [];
  for (let i = -5; i <= 5; i++) {
    if (i === 0) {
      continue;
    }
    const r = row + dr * i;
    const c = col + dc * i;
    if (!isValidPosition(r, c) || board[r]?.[c]) {
      continue;
    }
    // countLine は起点を色に関係なく 1 と数えるので、空点に対して呼べば
    // 「そこに color を置いたときの連の長さ」になる（盤面を書き換える必要はない）。
    const total = countLine(board, r, c, dr, dc, color);
    const isFive = color === "black" ? total === 5 : total >= 5;
    if (isFive) {
      points.push({ row: r, col: c });
    }
  }
  return points;
}

/**
 * 指定方向に連続する石の数をカウント
 *
 * @param board 盤面
 * @param row 起点の行
 * @param col 起点の列
 * @param dr 行方向のベクトル
 * @param dc 列方向のベクトル
 * @param color 石の色
 * @returns 連続する石の数（起点自身を含む）
 */
export function countLine(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): number {
  let count = 1; // 起点自身

  // 正方向
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    count++;
    r += dr;
    c += dc;
  }

  // 負方向
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    count++;
    r -= dr;
    c -= dc;
  }

  return count;
}

/**
 * 連の両端の状態をチェック
 *
 * @param board 盤面
 * @param row 起点の行
 * @param col 起点の列
 * @param dr 行方向のベクトル
 * @param dc 列方向のベクトル
 * @param color 石の色
 * @returns 両端の開閉状態（end1Open: 正方向端が空き, end2Open: 負方向端が空き）
 */
export function checkEnds(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { end1Open: boolean; end2Open: boolean } {
  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r += dr;
    c += dc;
  }
  const end1Open = isValidPosition(r, c) && board[r]?.[c] === null;

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r -= dr;
    c -= dc;
  }
  const end2Open = isValidPosition(r, c) && board[r]?.[c] === null;

  return { end1Open, end2Open };
}

/**
 * 4連専用の端チェック（黒の長連判定付き）
 *
 * checkEnds と同じだが、黒番のとき開き端の1マス先に黒石があれば
 * その端を閉じと判定する（打つと6連=長連になるため）。
 * 白番では checkEnds と同一動作。
 */
export function checkEndsForFour(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { end1Open: boolean; end2Open: boolean } {
  // 正方向の端（端位置を保持して再走査を回避）
  let end1R = row + dr;
  let end1C = col + dc;
  while (isValidPosition(end1R, end1C) && board[end1R]?.[end1C] === color) {
    end1R += dr;
    end1C += dc;
  }
  let end1Open =
    isValidPosition(end1R, end1C) && board[end1R]?.[end1C] === null;

  // 負方向の端
  let end2R = row - dr;
  let end2C = col - dc;
  while (isValidPosition(end2R, end2C) && board[end2R]?.[end2C] === color) {
    end2R -= dr;
    end2C -= dc;
  }
  let end2Open =
    isValidPosition(end2R, end2C) && board[end2R]?.[end2C] === null;

  // 黒番: 開き端の1マス先に黒石があれば長連 → その端は無効
  if (color === "black") {
    if (end1Open) {
      const beyondR = end1R + dr;
      const beyondC = end1C + dc;
      if (
        isValidPosition(beyondR, beyondC) &&
        board[beyondR]?.[beyondC] === "black"
      ) {
        end1Open = false;
      }
    }
    if (end2Open) {
      const beyondR = end2R - dr;
      const beyondC = end2C - dc;
      if (
        isValidPosition(beyondR, beyondC) &&
        board[beyondR]?.[beyondC] === "black"
      ) {
        end2Open = false;
      }
    }
  }

  return { end1Open, end2Open };
}

/**
 * 連の両端の位置を取得
 *
 * @param board 盤面
 * @param row 起点の行
 * @param col 起点の列
 * @param dr 行方向のベクトル
 * @param dc 列方向のベクトル
 * @param color 石の色
 * @returns 両端の空き位置（空いている端のみ含む）
 */
export function getLineEnds(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): Position[] {
  const positions: Position[] = [];

  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r -= dr;
    c -= dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  return positions;
}
