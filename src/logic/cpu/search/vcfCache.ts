/**
 * VCF結果キャッシュ
 *
 * VCT探索の反復深化で同一盤面の VCF 結果を再利用するためのキャッシュ。
 * 各トップレベルエントリポイントでローカルに作成・破棄する。
 */

import type { BoardState } from "@/types/game";

import { computeBoardHash } from "../zobrist";

// eslint-disable-next-line no-bitwise -- キャッシュキーの色区別にXORが必要
const COLOR_SALT = 0x9e3779b97f4a7c15n;

export interface VCFResultCache {
  cache: Map<bigint, boolean>;
}

export function createVCFCache(): VCFResultCache {
  return { cache: new Map() };
}

function cacheKey(board: BoardState, color: "black" | "white"): bigint {
  const hash = computeBoardHash(board);
  // eslint-disable-next-line no-bitwise -- キャッシュキーの色区別にXORが必要
  return color === "black" ? hash : hash ^ COLOR_SALT;
}

export function lookupVCF(
  c: VCFResultCache,
  board: BoardState,
  color: "black" | "white",
): boolean | undefined {
  return c.cache.get(cacheKey(board, color));
}

export function storeVCF(
  c: VCFResultCache,
  board: BoardState,
  color: "black" | "white",
  result: boolean,
): void {
  c.cache.set(cacheKey(board, color), result);
}
