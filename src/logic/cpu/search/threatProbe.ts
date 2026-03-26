/**
 * Threat Probe（脅威プローブ）
 *
 * Minimax内部ノードで**手番側**のVCF/VCTをチェックし、
 * 四追い勝ちや脅威連鎖があれば即座にカットオフする。
 *
 * 手番側のみをチェックする理由:
 * - VCF/VCT は「この色が手番を持ったら勝てるか」の判定
 * - 相手の脅威は「相手が次に手番を持ったら」の話で、自分が防御できる
 * - 相手の脅威検出は既存の mandatoryDefense + minimax 通常探索が担当
 */

import type { BoardState, Position } from "@/types/game";

import type { LineTable } from "../lineTable/lineTable";

import { findFourMovesFast } from "../lineTable/lineFourMoves";
import { findVCFMove, type VCFSearchOptions } from "./vcf";
import { findVCTMove, type VCTSearchOptions } from "./vct";

// =============================================================================
// Threat Probe Cache
// =============================================================================

/* eslint-disable no-bitwise -- キャッシュキーの色区別にXORが必要 */
const COLOR_SALT = 0x9e3779b97f4a7c15n;

/**
 * 脅威プローブ結果
 * - { move: Position }: VCF/VCTあり（初手）
 * - false: 脅威なし（ネガティブキャッシュ）
 */
type ThreatProbeResult = { move: Position } | false;

/**
 * 脅威プローブキャッシュ
 *
 * hash + color → Position | false
 * ネガティブキャッシュが重要: ほとんどの局面にはVCFがなく、
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
 */
export function getThreatBudget(minimaxDepth: number): ThreatBudget {
  // LineTable 早期フィルタで四候補なしの局面は即スキップされるため、
  // VCF探索に到達する局面は「四が作れる見込みがある」場合のみ。
  if (minimaxDepth >= 4) {
    // PVノードでのみ vctDepth > 0 が活きる（minimaxCore で制御）
    return { vcfDepth: 8, vcfNodes: 200, vctDepth: 6, vctNodes: 1000 };
  }
  // depth 3（minimaxCore で depth >= 3 のみ呼ばれる）
  return { vcfDepth: 6, vcfNodes: 100, vctDepth: 0, vctNodes: 0 };
}

// =============================================================================
// Threat Probe 本体
// =============================================================================

/**
 * 脅威プローブ: 手番側のVCF/VCTをチェック
 *
 * @param board 盤面
 * @param color 手番（この色のVCF/VCTをチェック）
 * @param hash 盤面ハッシュ
 * @param minimaxDepth minimax残り深度
 * @param threatCache キャッシュ
 * @param enableVCT VCTを有効にするか
 * @param lineTable LineTable（早期フィルタ用）
 * @returns VCF/VCTの初手（あれば）、なければ null
 */
export function threatProbe(
  board: BoardState,
  color: "black" | "white",
  hash: bigint,
  minimaxDepth: number,
  threatCache: ThreatProbeCache,
  enableVCT: boolean,
  lineTable?: LineTable,
  noTimeLimit = false,
): Position | null {
  // 1. キャッシュチェック
  const cached = lookupThreatProbe(threatCache, hash, color);
  if (cached === false) {
    return null;
  }
  if (cached !== undefined) {
    return cached.move;
  }

  // 2. LineTable 早期フィルタ: 四候補が0個なら VCF は不可能
  if (lineTable) {
    const fourMoves = findFourMovesFast(lineTable, color);
    if (fourMoves.length === 0) {
      storeThreatProbe(threatCache, hash, color, false);
      return null;
    }
  }

  // 3. 深度適応型バジェット取得
  const budget = getThreatBudget(minimaxDepth);

  // 4. VCF探索（高速・狭い分岐）
  const vcfOptions: VCFSearchOptions = {
    maxDepth: budget.vcfDepth,
    maxNodes: budget.vcfNodes,
    timeLimit: noTimeLimit ? Infinity : 20,
  };
  const vcfMove = findVCFMove(board, color, vcfOptions);
  if (vcfMove) {
    storeThreatProbe(threatCache, hash, color, { move: vcfMove });
    return vcfMove;
  }

  // 5. VCT探索（VCF失敗時、予算が許す場合のみ）
  if (budget.vctDepth > 0 && enableVCT) {
    const vctTime = noTimeLimit ? Infinity : 150;
    const vctOptions: VCTSearchOptions = {
      maxDepth: budget.vctDepth,
      maxNodes: budget.vctNodes,
      timeLimit: vctTime,
      vcfOptions: {
        maxDepth: budget.vcfDepth,
        maxNodes: budget.vcfNodes,
        timeLimit: vctTime,
      },
    };
    const vctMove = findVCTMove(board, color, vctOptions, lineTable);
    if (vctMove) {
      storeThreatProbe(threatCache, hash, color, { move: vctMove });
      return vctMove;
    }
  }

  // 6. ネガティブキャッシュ
  storeThreatProbe(threatCache, hash, color, false);
  return null;
}
