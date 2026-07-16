/**
 * cpu.worker.ts のオープニングブック適用条件（opening-book-2026-07-16.md §2）。
 *
 * DifficultyParams 型は変更しない（他難易度・既存テストへの波及を避けるため）専用定数。
 */
import type { CpuDifficulty } from "@/types/cpu";

/** ブックを有効化する難易度。 */
export const BOOK_ENABLED_DIFFICULTIES: readonly CpuDifficulty[] = ["hard"];

/** ブック適用対象の最小手数（moveCount=3 → ply4。plies1-3はopening.tsの領域）。 */
const BOOK_MIN_MOVE_COUNT = 3;

/** ブック適用対象の最大手数（moveCount=7 → ply8）。 */
const BOOK_MAX_MOVE_COUNT = 7;

/**
 * 白番・ply4〜8（moveCount 3〜7）のブック対象範囲内かどうか（難易度に依存しない）。
 * 振り返り注釈（review.worker.ts）は対局の難易度によらず、この範囲内の白手だけを
 * ブックと突き合わせる（§3）。
 */
export function isWithinBookRange(
  turn: "black" | "white",
  moveCount: number,
): boolean {
  return (
    turn === "white" &&
    moveCount >= BOOK_MIN_MOVE_COUNT &&
    moveCount <= BOOK_MAX_MOVE_COUNT
  );
}

/**
 * この局面でオープニングブックを着手選択に使うべきか（cpu.worker.ts 専用）。
 * 白番・ply4〜8（moveCount 3〜7）・対象難易度のときのみ true。
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
