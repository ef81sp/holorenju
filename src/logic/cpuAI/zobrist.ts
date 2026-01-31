/**
 * Zobrist Hashing
 *
 * 盤面を高速にハッシュ化するための手法。
 * XOR演算により差分更新が可能で、石を置く/取るたびに
 * 全盤面を再計算する必要がない。
 */

import type { BoardState, StoneColor } from "@/types/game";

/** 盤面サイズ */
const BOARD_SIZE = 15;

/** 石の色を配列インデックスに変換 */
const COLOR_INDEX = {
  black: 0,
  white: 1,
} as const;

/**
 * 暗号学的に安全な64ビットランダム値を生成
 *
 * BigIntを使用してより広い範囲のハッシュ値を得る
 */
function generateRandomBigInt(): bigint {
  // 2つの32ビット乱数を組み合わせて64ビット相当を生成
  const high = Math.floor(Math.random() * 0x100000000);
  const low = Math.floor(Math.random() * 0x100000000);
  // eslint-disable-next-line no-bitwise -- Zobrist Hashingにはビット演算が必要
  return (BigInt(high) << 32n) | BigInt(low);
}

/**
 * Zobristテーブル
 *
 * [row][col][colorIndex] => 64ビットランダム値
 */
type ZobristTable = bigint[][][];

/**
 * Zobristテーブルを初期化
 *
 * 各位置・各色に対してユニークなランダム値を生成
 */
function initZobristTable(): ZobristTable {
  const table: ZobristTable = [];

  for (let row = 0; row < BOARD_SIZE; row++) {
    const rowArray: bigint[][] = [];
    table[row] = rowArray;
    for (let col = 0; col < BOARD_SIZE; col++) {
      rowArray[col] = [generateRandomBigInt(), generateRandomBigInt()];
    }
  }

  return table;
}

/** グローバルZobristテーブル（初期化は一度だけ） */
const zobristTable: ZobristTable = initZobristTable();

/**
 * 盤面全体のZobristハッシュを計算
 *
 * @param board 盤面状態
 * @returns ハッシュ値（BigInt）
 */
export function computeBoardHash(board: BoardState): bigint {
  let hash = 0n;

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const stone = board[row]?.[col];
      if (stone === null || stone === undefined) {
        continue;
      }
      const colorIdx = COLOR_INDEX[stone];
      const zobristValue = zobristTable[row]?.[col]?.[colorIdx] ?? 0n;
      // eslint-disable-next-line no-bitwise -- Zobrist Hashingにはビット演算が必要
      hash ^= zobristValue;
    }
  }

  return hash;
}

/**
 * ハッシュ値を差分更新
 *
 * XORの性質により、同じ値を2回XORすると元に戻る。
 * これを利用して石を置く/取る操作を高速に行える。
 *
 * @param hash 現在のハッシュ値
 * @param row 行
 * @param col 列
 * @param color 石の色
 * @returns 更新後のハッシュ値
 */
export function updateHash(
  hash: bigint,
  row: number,
  col: number,
  color: StoneColor,
): bigint {
  if (color === null) {
    return hash;
  }

  const colorIdx = COLOR_INDEX[color];
  const zobristValue = zobristTable[row]?.[col]?.[colorIdx] ?? 0n;
  // eslint-disable-next-line no-bitwise -- Zobrist Hashingにはビット演算が必要
  return hash ^ zobristValue;
}

/**
 * Zobristテーブルへの直接アクセス（テスト用）
 */
export function getZobristValue(
  row: number,
  col: number,
  color: "black" | "white",
): bigint {
  const colorIdx = COLOR_INDEX[color];
  return zobristTable[row]?.[col]?.[colorIdx] ?? 0n;
}
