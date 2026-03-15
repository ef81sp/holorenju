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
  it("depth >= 4 で最大予算", () => {
    const budget = getThreatBudget(4);
    expect(budget.vcfDepth).toBe(4);
    expect(budget.vcfNodes).toBe(80);
    expect(budget.vctDepth).toBe(0);
  });

  it("depth 3 で基本予算", () => {
    const budget = getThreatBudget(3);
    expect(budget.vcfDepth).toBe(4);
    expect(budget.vcfNodes).toBe(50);
    expect(budget.vctDepth).toBe(0);
  });

  it("depth 2 以下も同じ（呼ばれないが安全）", () => {
    const budget = getThreatBudget(2);
    expect(budget.vcfDepth).toBe(4);
    expect(budget.vcfNodes).toBe(50);
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
  it("空の盤面ではVCFなし", () => {
    const board = createBoardWithStones([]);
    const hash = computeBoardHash(board);
    const cache = createThreatProbeCache();
    const result = threatProbe(board, "black", hash, 4, cache, false);
    expect(result).toBeNull();
    // ネガティブキャッシュが保存されている
    expect(lookupThreatProbe(cache, hash, "black")).toBe(false);
  });

  it("VCFがある局面を検出", () => {
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
    // キャッシュに保存されている
    const cached = lookupThreatProbe(cache, hash, "black");
    expect(cached).not.toBe(false);
    expect(cached).toBeTruthy();
  });

  it("ネガティブキャッシュで二重チェックを防ぐ", () => {
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    const hash = computeBoardHash(board);
    const cache = createThreatProbeCache();

    // 1回目: 探索実行
    const result1 = threatProbe(board, "black", hash, 4, cache, false);
    expect(result1).toBeNull();

    // 2回目: キャッシュヒット（探索をスキップ）
    const result2 = threatProbe(board, "black", hash, 4, cache, false);
    expect(result2).toBeNull();
  });
});
