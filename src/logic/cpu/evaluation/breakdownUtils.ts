/**
 * スコア表示ユーティリティ
 *
 * ReviewVerdict.vue でスコアを符号付き表示するための関数。
 * （#43 PR-4: 内訳パネル廃止に伴い、内訳抽出/フォーマット関数は削除。formatScore のみ存続）
 */

/**
 * スコアを符号付きで表示
 */
export function formatScore(score: number): string {
  if (score >= 0) {
    return `+${score}`;
  }
  return String(score);
}
