/**
 * 序盤トラップ採掘のルート集合（opening-trap-mining-2026-07-16.md §3）。
 *
 * 黒1=天元（ルール）、白2=CPU の実機挙動（間接/直接の両クラスをカバー）、
 * 黒3=自由。ルート = 26珠型（黒3が天元5×5箱内の全カノニカル形をカバー）
 * ＋ 珠型外ルート（黒3が白2の周囲2マス内だが天元から距離3以上のセル）。
 *
 * 再利用（solid S1）: 珠型 = opening.ts の getAllJushuNames()/getJushuPositions()。
 * 周囲2マス = moveGenerator.ts の isNearExistingStone()。
 */
import type { Position } from "@/types/game";

import { BOARD_SIZE, TENGEN } from "@/constants";
import { canonicalKey } from "@/logic/boardSymmetry";
import { isNearExistingStone } from "@/logic/cpu/moveGenerator";
import { getAllJushuNames, getJushuPositions } from "@/logic/cpu/opening";
import { createEmptyBoard } from "@/logic/renjuRules";

export interface RouteRoot {
  name: string;
  /** [黒1(天元), 白2, 黒3] */
  positions: [Position, Position, Position];
}

/** 珠型ルート集合: 26珠型すべて（間接13+直接13、白2位置は各珠型の基準方向固定）。 */
export function buildJushuRoots(): RouteRoot[] {
  const roots: RouteRoot[] = [];
  for (const name of getAllJushuNames()) {
    const positions = getJushuPositions(name, true);
    if (!positions) {
      continue;
    }
    roots.push({ name, positions });
  }
  return roots;
}

/** 珠型外ルートの白2基準位置（間接=斜め、直接=縦横の2クラスをカバー）。 */
const OFF_JUSHU_WHITE_POSITIONS: Position[] = [
  { row: TENGEN.row - 1, col: TENGEN.col + 1 }, // 間接（斜め）基準
  { row: TENGEN.row - 1, col: TENGEN.col }, // 直接（縦横）基準
];

/** 天元から距離3以上（珠型は天元5×5箱＝チェビシェフ距離2以内に収まるため、その外側）。 */
const OFF_JUSHU_MIN_TENGEN_DISTANCE = 3;

/** 白2の周囲2マス（isNearExistingStone のデフォルト range）。 */
const OFF_JUSHU_NEAR_RANGE = 2;

/**
 * 珠型外ルート集合: 黒3が白2の周囲2マス内だが天元から距離3以上のセル。
 * 対称正規化（canonical key）で重複除去する（global-D4 dedup）。
 */
export function buildOffJushuRoots(): RouteRoot[] {
  const seen = new Set<string>();
  const roots: RouteRoot[] = [];

  for (const whitePos of OFF_JUSHU_WHITE_POSITIONS) {
    // 「白2の周囲2マス」の判定用: 白2だけを置いた一時盤面で isNearExistingStone を使う
    const whiteOnlyBoard = createEmptyBoard();
    whiteOnlyBoard[whitePos.row]![whitePos.col] = "white";

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (row === TENGEN.row && col === TENGEN.col) {
          continue;
        }
        if (row === whitePos.row && col === whitePos.col) {
          continue;
        }
        if (
          !isNearExistingStone(whiteOnlyBoard, row, col, OFF_JUSHU_NEAR_RANGE)
        ) {
          continue;
        }
        const chebyshevFromTengen = Math.max(
          Math.abs(row - TENGEN.row),
          Math.abs(col - TENGEN.col),
        );
        if (chebyshevFromTengen < OFF_JUSHU_MIN_TENGEN_DISTANCE) {
          continue; // 珠型内（天元5×5箱）は除外
        }

        const board = createEmptyBoard();
        board[TENGEN.row]![TENGEN.col] = "black";
        board[whitePos.row]![whitePos.col] = "white";
        board[row]![col] = "black";

        // 黒3着手後は白番
        const key = canonicalKey(board, "white");
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        roots.push({
          name: `offJushu-${roots.length + 1}`,
          positions: [{ ...TENGEN }, whitePos, { row, col }],
        });
      }
    }
  }
  return roots;
}

/** 珠型ルート + 珠型外ルートの全体集合。 */
export function buildAllRoots(): RouteRoot[] {
  return [...buildJushuRoots(), ...buildOffJushuRoots()];
}
