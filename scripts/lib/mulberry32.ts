/**
 * 決定的疑似乱数生成器（mulberry32）と、複合キーからシードを合成する mix 関数。
 *
 * ベンチマークで「同一 --seed なら同一棋譜」を保証するために使う。
 * commit-bench の CLI --seed で baseSeed を固定し、局ごとの実効 seed は
 * `mixSeed(baseSeed, gameIdx)`、bridge worker の 1 手ごとの seed は
 * さらに `mixSeed(perGameSeed, moveOrdinal)` で導出する（stateless per-move）。
 *
 * 実装は Tommy Ettinger の mulberry32 - 32-bit 状態、周期 2^32、高速。
 * ベンチマーク用途（脅威判定の代替ではない）なので暗号強度は不要。
 */

/**
 * seed から (0, 1) の一様乱数を返す関数を作る。
 * mulberry32 は seed=0 でも合法（内部で加算するため）。
 */
export function mulberry32(seed: number): () => number {
  // 32-bit に切り詰めておく（負値でも動くが挙動を単純化するため）
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 複数の整数キーを合成して 32-bit シードを作る。
 * `hashCombine(a, b) = (a * 31 + b) | 0` 相当を FNV っぽく混ぜたもの。
 * 目的は「異なる (a, b) から異なる seed が高確率で得られる」だけで、
 * 全単射でも一様性でもない。ベンチ用途には十分。
 */
export function mixSeed(...keys: number[]): number {
  let h = 0x811c9dc5 | 0; // FNV-1a offset basis
  for (const k of keys) {
    h ^= k | 0;
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h | 0;
}
