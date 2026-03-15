/**
 * Threat Probe（脅威プローブ）
 *
 * Minimax内部ノードで手番側のVCF/VCTをチェックし、
 * 四追い勝ちや脅威連鎖があれば即座にカットオフする。
 *
 * preSearchでしかVCF/VCTを実行していなかった構造的弱点を解消し、
 * 探索途中で発生する四追い勝ちを検出する。
 */

import type { BoardState, Position } from "@/types/game";

import { findVCFMove, type VCFSearchOptions } from "./vcf";
import { findVCTMove, type VCTSearchOptions } from "./vct";

// =============================================================================
// Threat Probe Cache
// =============================================================================

/* eslint-disable no-bitwise -- キャッシュキーの色区別にXORが必要 */
const COLOR_SALT = 0x9e3779b97f4a7c15n;

/**
 * 脅威プローブ結果
 * - Position: 脅威あり（VCF/VCTの初手）
 * - false: 脅威なし（ネガティブキャッシュ）
 */
type ThreatProbeResult = { move: Position } | false;

/**
 * 脅威プローブキャッシュ
 *
 * hash + color → Position | false
 * ネガティブキャッシュ（false）が重要: ほとんどの局面にはVCFがなく、
 * 同じ局面の再チェックを防ぐ。
 */
export interface ThreatProbeCache {
  cache: Map<bigint, ThreatProbeResult>;
}

export function createThreatProbeCache(): ThreatProbeCache {
  return { cache: new Map() };
}

function probeCacheKey(hash: bigint, color: "black" | "white"): bigint {
  return color === "black" ? hash : hash ^ COLOR_SALT;
}
/* eslint-enable no-bitwise */

export function lookupThreatProbe(
  c: ThreatProbeCache,
  hash: bigint,
  color: "black" | "white",
): ThreatProbeResult | undefined {
  return c.cache.get(probeCacheKey(hash, color));
}

export function storeThreatProbe(
  c: ThreatProbeCache,
  hash: bigint,
  color: "black" | "white",
  result: ThreatProbeResult,
): void {
  c.cache.set(probeCacheKey(hash, color), result);
}

// =============================================================================
// 深度適応型バジェット
// =============================================================================

interface ThreatBudget {
  vcfDepth: number;
  vcfNodes: number;
  vctDepth: number;
  vctNodes: number;
}

/**
 * minimax残り深度に応じたVCF/VCTの探索予算を返す
 *
 * 深い残り深度ほど大きな予算を割り当てる。
 * VCTは depth >= 3 のみで実行（浅い深度ではコスト見合い）。
 */
export function getThreatBudget(minimaxDepth: number): ThreatBudget {
  if (minimaxDepth >= 4) {
    // PVノードでのみ vctDepth > 0 が活きる（minimaxCore で制御）
    return { vcfDepth: 4, vcfNodes: 80, vctDepth: 2, vctNodes: 150 };
  }
  // depth 3（minimaxCore で depth >= 3 のみ呼ばれる）
  return { vcfDepth: 4, vcfNodes: 50, vctDepth: 0, vctNodes: 0 };
}

// =============================================================================
// Threat Probe 本体
// =============================================================================

/**
 * 脅威プローブ: 手番側のVCF/VCTをチェック
 *
 * @param board 盤面
 * @param color 手番
 * @param hash 盤面ハッシュ
 * @param minimaxDepth minimax残り深度
 * @param threatCache キャッシュ
 * @param enableVCT VCTを有効にするか
 * @returns 脅威の初手（あれば）、なければ null
 */
export function threatProbe(
  board: BoardState,
  color: "black" | "white",
  hash: bigint,
  minimaxDepth: number,
  threatCache: ThreatProbeCache,
  enableVCT: boolean,
): Position | null {
  // 1. キャッシュチェック
  const cached = lookupThreatProbe(threatCache, hash, color);
  if (cached === false) {
    return null;
  }
  if (cached !== undefined) {
    return cached.move;
  }

  // 2. 深度適応型バジェット取得
  const budget = getThreatBudget(minimaxDepth);

  // 3. VCF探索（高速・狭い分岐）
  const vcfOptions: VCFSearchOptions = {
    maxDepth: budget.vcfDepth,
    maxNodes: budget.vcfNodes,
    timeLimit: 20, // タイムアウト安全弁（ノード制限が主な予算管理）
  };
  const vcfMove = findVCFMove(board, color, vcfOptions);
  if (vcfMove) {
    storeThreatProbe(threatCache, hash, color, { move: vcfMove });
    return vcfMove;
  }

  // 4. VCT探索（VCF失敗時、予算が許す場合のみ）
  if (budget.vctDepth > 0 && enableVCT) {
    const vctOptions: VCTSearchOptions = {
      maxDepth: budget.vctDepth,
      maxNodes: budget.vctNodes,
      timeLimit: 50,
      vcfOptions: {
        maxDepth: budget.vcfDepth,
        maxNodes: budget.vcfNodes,
        timeLimit: 50,
      },
    };
    const vctMove = findVCTMove(board, color, vctOptions);
    if (vctMove) {
      storeThreatProbe(threatCache, hash, color, { move: vctMove });
      return vctMove;
    }
  }

  // 5. ネガティブキャッシュ
  storeThreatProbe(threatCache, hash, color, false);
  return null;
}
