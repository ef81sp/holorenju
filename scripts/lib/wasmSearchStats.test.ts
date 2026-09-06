import { describe, expect, it } from "vitest";

import {
  SEARCH_FEATURE_DETERMINISTIC,
  SEARCH_FEATURE_EXTENDED_STATS,
  STATS_BUFFER_BASE_BYTES,
  STATS_BUFFER_EXTENDED_BYTES,
  hasExtendedStats,
  readWasmSearchStats,
} from "./wasmSearchStats.ts";

/** u32 × n を little-endian で並べた ArrayBuffer を作る。 */
function makeStatsBuffer(values: number[], extraTrailing = 0): DataView {
  const buf = new ArrayBuffer(values.length * 4 + extraTrailing);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setUint32(i * 4, v, true));
  return view;
}

const base12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

describe("readWasmSearchStats", () => {
  it("features bit1 無し: 48 バイト分だけ読み、拡張フィールドは undefined", () => {
    // 隣接メモリに値が入っていても読まない
    const view = makeStatsBuffer([...base12, 999, 888]);
    const stats = readWasmSearchStats(view, 0, 0);
    expect(stats).toEqual({
      nodes: 1,
      ttHits: 2,
      ttCutoffs: 3,
      betaCutoffs: 4,
      nullMoveTrials: 5,
      nullMoveCutoffs: 6,
      futilityPrunes: 7,
      threatExtensions: 8,
      lmrTrials: 9,
      lmrResearches: 10,
      qSearchNodes: 11,
      threatProbeCutoffs: 12,
    });
    expect("preSearchNodes" in stats).toBe(false);
  });

  it("features bit1 あり: 56 バイト読み pre_search_nodes / probe_nodes を末尾から取る", () => {
    const view = makeStatsBuffer([...base12, 4321, 765]);
    const stats = readWasmSearchStats(view, 0, SEARCH_FEATURE_EXTENDED_STATS);
    expect(stats.preSearchNodes).toBe(4321);
    expect(stats.probeNodes).toBe(765);
    expect(stats.nodes).toBe(1);
  });

  it("bufferLength >= 60 なら absolute_deadline_hit も読む（bit1 だけでは読まない）", () => {
    const view = makeStatsBuffer([...base12, 1, 2, 1]);
    expect(
      readWasmSearchStats(view, 0, SEARCH_FEATURE_EXTENDED_STATS),
    ).not.toHaveProperty("absoluteDeadlineHit");
    expect(
      readWasmSearchStats(view, 0, SEARCH_FEATURE_EXTENDED_STATS, 56),
    ).not.toHaveProperty("absoluteDeadlineHit");
    expect(
      readWasmSearchStats(view, 0, SEARCH_FEATURE_EXTENDED_STATS, 60)
        .absoluteDeadlineHit,
    ).toBe(true);
    // bit1 無しなら bufferLength があっても拡張部は読まない
    expect(readWasmSearchStats(view, 0, 0, 60)).not.toHaveProperty(
      "absoluteDeadlineHit",
    );
  });

  it("ptr オフセットを尊重する", () => {
    const view = makeStatsBuffer([0, 0, ...base12, 5, 6]);
    const stats = readWasmSearchStats(
      view,
      8,
      SEARCH_FEATURE_EXTENDED_STATS | SEARCH_FEATURE_DETERMINISTIC,
    );
    expect(stats.nodes).toBe(1);
    expect(stats.threatProbeCutoffs).toBe(12);
    expect(stats.preSearchNodes).toBe(5);
    expect(stats.probeNodes).toBe(6);
  });

  it("バイト長定数はレイアウトと一致（12×4=48、+2×4=56）", () => {
    expect(STATS_BUFFER_BASE_BYTES).toBe(48);
    expect(STATS_BUFFER_EXTENDED_BYTES).toBe(56);
  });
});

describe("hasExtendedStats", () => {
  it("bit1 のみを見る", () => {
    expect(hasExtendedStats(0)).toBe(false);
    expect(hasExtendedStats(SEARCH_FEATURE_DETERMINISTIC)).toBe(false);
    expect(hasExtendedStats(SEARCH_FEATURE_EXTENDED_STATS)).toBe(true);
    expect(hasExtendedStats(0b11)).toBe(true);
  });
  it("features 未取得（undefined = 旧 wasm）は false", () => {
    expect(hasExtendedStats(undefined)).toBe(false);
  });
});
