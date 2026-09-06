/**
 * 候補手グリッドのスコア差（delta = searchScore − best）の表示整形
 *
 * 真値でない候補（root alpha-beta の fail-low 境界値＝上限）は「≤」を前置する
 * （review-multipv-2026-09-06.md §2.5 経路 3）。値そのものは変えない。
 */
export function formatCandidateDelta(
  delta: number,
  scoreExact: boolean | undefined,
): string {
  const body = delta === 0 ? "±0" : delta.toLocaleString("en");
  return scoreExact ? body : `≤${body}`;
}
