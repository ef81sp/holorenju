/**
 * cpu.worker.ts のオープニングブック適用条件（opening-book-2026-07-16.md §2）。
 *
 * DifficultyParams 型は変更しない（他難易度・既存テストへの波及を避けるため）専用定数。
 */
import type { CpuDifficulty } from "@/types/cpu";

/** ブックを有効化する難易度。 */
export const BOOK_ENABLED_DIFFICULTIES: readonly CpuDifficulty[] = ["hard"];

/**
 * ブック適用対象の手数レンジ（moveCount = 着手前の石数）。色によって異なる
 * （黒の ply1/3 は opening.ts の珠型ロジックの領域のため、黒のブックは
 * ply5/7=moveCount4/6 のみ。白は珠型が2手目までなので ply4〜8=moveCount3〜7）。
 * 黒対応は最小構成（採掘で見つかった severity-A 1局面のみ個別収録。
 * opening-book-2026-07-16.md 黒対応）。
 */
const BOOK_MOVE_COUNT_RANGE: Record<
  "black" | "white",
  { min: number; max: number }
> = {
  white: { min: 3, max: 7 },
  black: { min: 4, max: 6 },
};

/**
 * ply4〜8（白）/ ply5〜7（黒）のブック対象範囲内かどうか（難易度に依存しない）。
 * 振り返り注釈（review.worker.ts）は対局の難易度によらず、この範囲内の手だけを
 * ブックと突き合わせる（§3）。
 */
export function isWithinBookRange(
  turn: "black" | "white",
  moveCount: number,
): boolean {
  const range = BOOK_MOVE_COUNT_RANGE[turn];
  return moveCount >= range.min && moveCount <= range.max;
}

/**
 * この局面でオープニングブックを着手選択に使うべきか（cpu.worker.ts 専用）。
 * ブック対象範囲内・対象難易度のときのみ true。
 */
export function isBookEligible(
  difficulty: CpuDifficulty,
  turn: "black" | "white",
  moveCount: number,
): boolean {
  return (
    BOOK_ENABLED_DIFFICULTIES.includes(difficulty) &&
    isWithinBookRange(turn, moveCount)
  );
}
