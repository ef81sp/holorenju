/**
 * Threat Probe のテスト
 */

import { describe, expect, it } from "vitest";

import { createBoardWithStones } from "../testUtils";
import { computeBoardHash } from "../zobrist";
import {
  createThreatProbeCache,
  getThreatBudget,
  lookupThreatProbe,
  storeThreatProbe,
  threatProbe,
} from "./threatProbe";

describe("getThreatBudget", () => {
  it("depth >= 4 で最大予算（VCT含む）", () => {
    const budget = getThreatBudget(4);
    expect(budget.vcfDepth).toBe(8);
    expect(budget.vcfNodes).toBe(200);
    expect(budget.vctDepth).toBe(6);
    expect(budget.vctNodes).toBe(2000);
  });

  it("depth 3 で基本予算", () => {
    const budget = getThreatBudget(3);
    expect(budget.vcfDepth).toBe(6);
    expect(budget.vcfNodes).toBe(100);
    expect(budget.vctDepth).toBe(0);
  });
});

describe("ThreatProbeCache", () => {
  it("キャッシュヒット: 脅威あり", () => {
    const cache = createThreatProbeCache();
    const hash = 12345n;
    storeThreatProbe(cache, hash, "black", { move: { row: 7, col: 7 } });
    const result = lookupThreatProbe(cache, hash, "black");
    expect(result).toEqual({ move: { row: 7, col: 7 } });
  });

  it("キャッシュヒット: ネガティブ", () => {
    const cache = createThreatProbeCache();
    const hash = 12345n;
    storeThreatProbe(cache, hash, "black", false);
    const result = lookupThreatProbe(cache, hash, "black");
    expect(result).toBe(false);
  });

  it("キャッシュミス", () => {
    const cache = createThreatProbeCache();
    const result = lookupThreatProbe(cache, 12345n, "black");
    expect(result).toBeUndefined();
  });

  it("色が異なればキャッシュは別", () => {
    const cache = createThreatProbeCache();
    const hash = 12345n;
    storeThreatProbe(cache, hash, "black", false);
    const result = lookupThreatProbe(cache, hash, "white");
    expect(result).toBeUndefined();
  });
});

describe("threatProbe", () => {
  it("空の盤面では脅威なし", () => {
    const board = createBoardWithStones([]);
    const hash = computeBoardHash(board);
    const cache = createThreatProbeCache();
    const result = threatProbe(board, "black", hash, 4, cache, false);
    expect(result).toBeNull();
    // ネガティブキャッシュが保存されている
    expect(lookupThreatProbe(cache, hash, "black")).toBe(false);
  });

  it("手番側のVCFを検出", () => {
    // 黒: H5, H6, H7 (活三 → 活四で即勝ち)
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);
    const hash = computeBoardHash(board);
    const cache = createThreatProbeCache();
    const result = threatProbe(board, "black", hash, 4, cache, false);
    expect(result).not.toBeNull();
  });

  it("ネガティブキャッシュで二重チェックを防ぐ", () => {
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    const hash = computeBoardHash(board);
    const cache = createThreatProbeCache();

    const result1 = threatProbe(board, "black", hash, 4, cache, false);
    expect(result1).toBeNull();

    const result2 = threatProbe(board, "black", hash, 4, cache, false);
    expect(result2).toBeNull();
  });

  it("手番側のみチェック（相手の脅威では反応しない）", () => {
    // 白が活三を持つが、黒番なので相手の脅威は検出しない
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 0, col: 0, color: "black" },
    ]);
    const hash = computeBoardHash(board);
    const cache = createThreatProbeCache();
    // 黒番: 白のVCFがあっても黒のthreatProbeは反応しない
    const result = threatProbe(board, "black", hash, 4, cache, false);
    expect(result).toBeNull();
  });
});
