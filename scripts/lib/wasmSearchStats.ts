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
 *   +68 walkin_checks, +72 walkin_switches, +76 walkin_skipped, +80 walkin_nodes
 *       （根の最善手の「自ら追い詰めに入る手」検証。opp-vct-walkin-2026-09-12.md §5.4。
 *       getStatsBufferLength() >= 84 の wasm のみ）
 *   +84 walkin_fired, +88 walkin_vct_nodes（同・発火回数と相手 VCT 検証の消費。
 *       getStatsBufferLength() >= 92 の wasm のみ）
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
/** walkin_checks（+68）/ walkin_switches（+72）/ walkin_skipped（+76）/ walkin_nodes（+80）を含む長さ */
export const STATS_BUFFER_WALKIN_STATS_BYTES = 84;
/** walkin_fired（+84）/ walkin_vct_nodes（+88）を含む長さ */
export const STATS_BUFFER_WALKIN_DETAIL_BYTES = 92;

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
  /**
   * 根の最善手の「自ら追い詰めに入る手」検証（V1）で相手の追い詰めを探した回数
   * （最善手 + 除外再探索の代替手。最大 3）。getStatsBufferLength() >= 84 の wasm のみ
   */
  walkinChecks?: number;
  /** V1 が最善手を安全な代替手に切り替えた回数（0/1）。getStatsBufferLength() >= 84 の wasm のみ */
  walkinSwitches?: number;
  /**
   * V1 の最善手検証が判定不能だった回数（0/1。予約なし・予算切れ・上限到達＝tripped）。
   * 発火後に再探索の時間が足りなかった件は数えない（walkinFired=1 かつ walkinSwitches=0 で分かる）。
   * 時間モードと固定モードの到達率較正に使う。getStatsBufferLength() >= 84 の wasm のみ
   */
  walkinSkipped?: number;
  /**
   * V1 の除外再探索の消費ノード（両モードで nodes に含まれる）。
   * getStatsBufferLength() >= 84 の wasm のみ（84 バイト版の wasm では相手 VCT 検証の消費も
   * 合算されていた）
   */
  walkinNodes?: number;
  /** V1 で最善手が「自ら追い詰めに入る手」と判定された回数（0/1）。getStatsBufferLength() >= 92 の wasm のみ */
  walkinFired?: number;
  /**
   * V1 の相手 VCT 検証の消費ノード（時間モードでは nodes に含まれない）。
   * getStatsBufferLength() >= 92 の wasm のみ
   */
  walkinVctNodes?: number;
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
    if (
      bufferLength !== undefined &&
      bufferLength >= STATS_BUFFER_WALKIN_STATS_BYTES
    ) {
      stats.walkinChecks = view.getUint32(ptr + 68, true);
      stats.walkinSwitches = view.getUint32(ptr + 72, true);
      stats.walkinSkipped = view.getUint32(ptr + 76, true);
      stats.walkinNodes = view.getUint32(ptr + 80, true);
    }
    if (
      bufferLength !== undefined &&
      bufferLength >= STATS_BUFFER_WALKIN_DETAIL_BYTES
    ) {
      stats.walkinFired = view.getUint32(ptr + 84, true);
      stats.walkinVctNodes = view.getUint32(ptr + 88, true);
    }
  }
  return stats;
}
