/**
 * 禁手判定キャッシュ
 *
 * Zobristハッシュ + 位置をキーにしたグローバルキャッシュで、
 * 同一盤面・同一位置の禁手判定を高速化する。
 */

import type { BoardState, ForbiddenMoveResult } from "@/types/game";

import { checkForbiddenMove } from "@/logic/renjuRules";

import { computeBoardHash } from "../zobrist";

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

/** 現在の盤面ハッシュ（computeBoardHashの呼び出しを最小化） */
let currentBoardHash: bigint | null = null;

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
  currentBoardHash = null;
}

/**
 * 現在の盤面ハッシュを設定
 *
 * 探索中に盤面が変わるたびに呼び出す
 */
export function setCurrentBoardHash(hash: bigint): void {
  currentBoardHash = hash;
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

/**
 * 禁手判定（キャッシュ付き）
 *
 * 同一盤面・同一位置の判定結果をキャッシュして高速化。
 * Zobristハッシュが提供されていない場合は計算する。
 *
 * @param board 盤面
 * @param row 行
 * @param col 列
 * @param hash オプションのZobristハッシュ（提供されない場合は計算）
 * @returns 禁手判定結果
 */
export function checkForbiddenMoveWithCache(
  board: BoardState,
  row: number,
  col: number,
  hash?: bigint,
): ForbiddenMoveResult {
  // ハッシュを取得（提供されていない場合は現在のハッシュを使用、なければ計算）
  const boardHash = hash ?? currentBoardHash ?? computeBoardHash(board);

  // キャッシュから取得を試みる
  const cached = getForbiddenResult(boardHash, row, col);
  if (cached !== undefined) {
    return cached;
  }

  // キャッシュミス：通常の禁手判定を実行
  const result = checkForbiddenMove(board, row, col);

  // 結果をキャッシュに保存
  setForbiddenResult(boardHash, row, col, result);

  return result;
}
