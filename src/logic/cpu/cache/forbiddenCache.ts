/**
 * 禁手判定キャッシュ
 *
 * Zobristハッシュ + 位置をキーにしたグローバルキャッシュで、
 * 同一盤面・同一位置の禁手判定を高速化する。
 */

import type { ForbiddenMoveResult } from "@/types/game";

/**
 * キャッシュエントリ
 */
interface CacheEntry {
  hash: bigint;
  result: ForbiddenMoveResult;
}

/**
 * 禁手キャッシュ
 *
 * Map<positionKey, CacheEntry> の形式で保持
 * positionKey = "row,col"
 */
const forbiddenCache = new Map<string, CacheEntry>();

/** キャッシュの最大エントリ数 */
const MAX_CACHE_SIZE = 100000;

/**
 * 位置からキーを生成
 */
function positionKey(row: number, col: number): string {
  return `${row},${col}`;
}

/**
 * キャッシュをクリア
 *
 * 探索開始時に呼び出す
 */
export function clearForbiddenCache(): void {
  forbiddenCache.clear();
}

/**
 * キャッシュから禁手判定結果を取得
 *
 * @param hash 盤面のZobristハッシュ
 * @param row 行
 * @param col 列
 * @returns キャッシュヒットした場合は結果、なければundefined
 */
export function getForbiddenResult(
  hash: bigint,
  row: number,
  col: number,
): ForbiddenMoveResult | undefined {
  const key = positionKey(row, col);
  const entry = forbiddenCache.get(key);

  if (entry && entry.hash === hash) {
    return entry.result;
  }

  return undefined;
}

/**
 * 禁手判定結果をキャッシュに保存
 *
 * @param hash 盤面のZobristハッシュ
 * @param row 行
 * @param col 列
 * @param result 禁手判定結果
 */
export function setForbiddenResult(
  hash: bigint,
  row: number,
  col: number,
  result: ForbiddenMoveResult,
): void {
  // キャッシュサイズ制限
  if (forbiddenCache.size >= MAX_CACHE_SIZE) {
    // 簡易的にクリア（LRUにするとオーバーヘッドが増える）
    forbiddenCache.clear();
  }

  const key = positionKey(row, col);
  forbiddenCache.set(key, { hash, result });
}

/**
 * キャッシュのサイズを取得（テスト用）
 */
export function getForbiddenCacheSize(): number {
  return forbiddenCache.size;
}
