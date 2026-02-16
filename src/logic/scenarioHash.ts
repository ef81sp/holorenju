/**
 * シナリオ構造ハッシュ計算
 *
 * セクションIDとタイプのみをハッシュ化する。
 * ダイアログ内容や盤面は含めない（セリフ修正で進行度を無効にしないため）。
 */

import type { Scenario } from "@/types/scenario";

/**
 * djb2 ハッシュ関数
 */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // unsigned 32-bit
}

/**
 * シナリオの構造ハッシュを計算する
 *
 * セクションのIDとタイプの組み合わせからハッシュを生成。
 * 構造が同じなら同じハッシュ、セクション追加/削除/タイプ変更/順序変更で異なるハッシュを返す。
 */
export function computeStructureHash(
  scenario: Pick<Scenario, "sections">,
): string {
  const input = scenario.sections.map((s) => `${s.id}:${s.type}`).join("|");
  return djb2(input).toString(36);
}
