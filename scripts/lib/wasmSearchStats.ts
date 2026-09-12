/**
 * wasm 探索統計バッファ（`getStatsBuffer`）のリーダー（SSoT）。
 *
 * レイアウトは zig/src/main.zig `writeStats` の fields 配列順に対応する u32 列:
 *   +0 nodes, +4 tt_hits, +8 tt_cutoffs, +12 beta_cutoffs, +16 null_move_trials,
 *   +20 null_move_cutoffs, +24 futility_prunes, +28 threat_extensions,
 *   +32 lmr_trials, +36 lmr_researches, +40 q_search_nodes, +44 threat_probe_cutoffs
 *   （ここまで 48 バイト＝旧 wasm の全体）
 *   +48 pre_search_nodes, +52 probe_nodes（bench-fixed-nodes-2026-09-06.md §2.4、append-only）
 *   +56 absolute_deadline_hit（§2.6 の安全弁が発火したか。0/1）
 *   +60 probe_calls, +64 probe_cap_hits（脅威プローブの呼び出し数 / VCT が上限で打ち切られた数。
 *       プローブ較正用。getStatsBufferLength() >= 68 の wasm のみ）
 *
 * 拡張フィールドの存在は `getSearchFeatures()` の bit1 で判定する。旧 wasm では
 * 48 バイトを越えて読まない（越えると隣接メモリを黙って読んでしまう）。
 * bit1 以降に append されたフィールド（+56〜）は `getStatsBufferLength()` の値で判定する。
 */

/** getSearchFeatures() bit0: setDeterministicMode 対応 */
export const SEARCH_FEATURE_DETERMINISTIC = 1 << 0;
/** getSearchFeatures() bit1: stats_buffer に pre_search_nodes / probe_nodes あり（56 バイト以上。現行 wasm は 60） */
export const SEARCH_FEATURE_EXTENDED_STATS = 1 << 1;

export const STATS_BUFFER_BASE_BYTES = 48;
/** bit1 が保証する最小長（+48 / +52 まで） */
export const STATS_BUFFER_EXTENDED_BYTES = 56;
/** absolute_deadline_hit（+56）を含む長さ */
export const STATS_BUFFER_DEADLINE_HIT_BYTES = 60;
/** probe_calls（+60）/ probe_cap_hits（+64）を含む長さ */
export const STATS_BUFFER_PROBE_STATS_BYTES = 68;

export interface WasmSearchStats {
  nodes: number;
  ttHits: number;
  ttCutoffs: number;
  betaCutoffs: number;
  nullMoveTrials: number;
  nullMoveCutoffs: number;
  futilityPrunes: number;
  threatExtensions: number;
  lmrTrials: number;
  lmrResearches: number;
  qSearchNodes: number;
  threatProbeCutoffs: number;
  /** 事前探索（VCF/相手VCF/ミセVCF/VCT）が消費したノード。features bit1 の wasm のみ */
  preSearchNodes?: number;
  /** 脅威プローブが消費したノード。features bit1 の wasm のみ */
  probeNodes?: number;
  /**
   * 決定的モードの安全弁（absolute_time_limit > 0）が発火したか。
   * getStatsBufferLength() >= 60 の wasm のみ（ベンチは 0 を渡すので通常 false）
   */
  absoluteDeadlineHit?: boolean;
  /** 脅威プローブ（threatProbe）の呼び出し回数。getStatsBufferLength() >= 68 の wasm のみ */
  probeCalls?: number;
  /**
   * 脅威プローブの VCT 探索が上限（時間 or ノード）で打ち切られた回数。
   * getStatsBufferLength() >= 68 の wasm のみ
   */
  probeCapHits?: number;
}

/** `getSearchFeatures()` の値（undefined = export 無しの旧 wasm）に拡張統計があるか。 */
export function hasExtendedStats(features: number | undefined): boolean {
  return (
    features !== undefined && (features & SEARCH_FEATURE_EXTENDED_STATS) !== 0
  );
}

/**
 * 統計バッファを読む。`features` は `getSearchFeatures()` の値（旧 wasm は undefined/0）、
 * `bufferLength` は `getStatsBufferLength()` の値（export の無い wasm は undefined）。
 */
export function readWasmSearchStats(
  view: DataView,
  ptr: number,
  features: number | undefined,
  bufferLength?: number,
): WasmSearchStats {
  const stats: WasmSearchStats = {
    nodes: view.getUint32(ptr, true),
    ttHits: view.getUint32(ptr + 4, true),
    ttCutoffs: view.getUint32(ptr + 8, true),
    betaCutoffs: view.getUint32(ptr + 12, true),
    nullMoveTrials: view.getUint32(ptr + 16, true),
    nullMoveCutoffs: view.getUint32(ptr + 20, true),
    futilityPrunes: view.getUint32(ptr + 24, true),
    threatExtensions: view.getUint32(ptr + 28, true),
    lmrTrials: view.getUint32(ptr + 32, true),
    lmrResearches: view.getUint32(ptr + 36, true),
    qSearchNodes: view.getUint32(ptr + 40, true),
    threatProbeCutoffs: view.getUint32(ptr + 44, true),
  };
  if (hasExtendedStats(features)) {
    stats.preSearchNodes = view.getUint32(ptr + 48, true);
    stats.probeNodes = view.getUint32(ptr + 52, true);
    if (
      bufferLength !== undefined &&
      bufferLength >= STATS_BUFFER_DEADLINE_HIT_BYTES
    ) {
      stats.absoluteDeadlineHit = view.getUint32(ptr + 56, true) !== 0;
    }
    if (
      bufferLength !== undefined &&
      bufferLength >= STATS_BUFFER_PROBE_STATS_BYTES
    ) {
      stats.probeCalls = view.getUint32(ptr + 60, true);
      stats.probeCapHits = view.getUint32(ptr + 64, true);
    }
  }
  return stats;
}
