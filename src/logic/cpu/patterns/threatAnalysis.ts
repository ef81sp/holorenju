/**
 * CPU脅威解析モジュール
 *
 * SSoT (Single Source of Truth) として脅威検出に関する関数を提供
 * - 跳び四の空き位置検出
 * - 跳び三の防御位置検出
 */

import type { BoardState, Position } from "@/types/game";

import { isValidPosition } from "@/logic/renjuRules";

// issue #121 / #43: `findJumpGapPosition`（跳び四のギャップを 5 マス窓の先頭から探す）は
// 削除した。受け点は `collectLineFivePoints`（ライン上の五点列挙）に一本化済みで、
// この関数は #115 の「長連ギャップを受けとして返す」バグの本体だった。
// Zig 側 `threats.findJumpGapPosition` も同時に削除している。

/**
 * 跳び三の防御位置を取得
 *
 * 跳び三パターン:
 * - パターン1: ・●●・●・ (両端と中間の空きが防御点)
 * - パターン2: ・●・●●・ (両端と中間の空きが防御点)
 *
 * @param board 盤面
 * @param row 起点の行
 * @param col 起点の列
 * @param dr 行方向のベクトル
 * @param dc 列方向のベクトル
 * @param color 石の色
 * @returns 防御位置の配列
 */
export function getJumpThreeDefensePositions(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): Position[] {
  const positions: Position[] = [];

  // ラインをスキャンして跳び三パターンの空きを探す
  const linePositions: { pos: Position; stone: "black" | "white" | null }[] =
    [];

  // 負方向に4マス
  for (let i = 4; i >= 1; i--) {
    const pr = row - dr * i;
    const pc = col - dc * i;
    if (isValidPosition(pr, pc)) {
      linePositions.push({
        pos: { row: pr, col: pc },
        stone: board[pr]?.[pc] ?? null,
      });
    }
  }

  // 置いた位置
  linePositions.push({
    pos: { row, col },
    stone: color,
  });

  // 正方向に4マス
  for (let i = 1; i <= 4; i++) {
    const pr = row + dr * i;
    const pc = col + dc * i;
    if (isValidPosition(pr, pc)) {
      linePositions.push({
        pos: { row: pr, col: pc },
        stone: board[pr]?.[pc] ?? null,
      });
    }
  }

  // 跳び三パターン ・●●・●・ または ・●・●●・ を探す
  for (let start = 0; start <= linePositions.length - 6; start++) {
    const segment = linePositions.slice(start, start + 6);
    if (segment.length !== 6) {
      continue;
    }

    const stones = segment.map((s) => s.stone);
    const posArr = segment.map((s) => s.pos);

    // パターン: ・●●・●・
    if (
      stones[0] === null &&
      stones[1] === color &&
      stones[2] === color &&
      stones[3] === null &&
      stones[4] === color &&
      stones[5] === null
    ) {
      // 両端と中間の空きが防御点
      if (posArr[0]) {
        positions.push(posArr[0]);
      }
      if (posArr[3]) {
        positions.push(posArr[3]);
      }
      if (posArr[5]) {
        positions.push(posArr[5]);
      }
    }

    // パターン: ・●・●●・
    if (
      stones[0] === null &&
      stones[1] === color &&
      stones[2] === null &&
      stones[3] === color &&
      stones[4] === color &&
      stones[5] === null
    ) {
      if (posArr[0]) {
        positions.push(posArr[0]);
      }
      if (posArr[2]) {
        positions.push(posArr[2]);
      }
      if (posArr[5]) {
        positions.push(posArr[5]);
      }
    }
  }

  return positions;
}
