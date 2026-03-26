/**
 * 振り返り解析の定数・プロファイルテスト
 *
 * 境界の防壁: 振り返り専用パラメータが対局CPUに漏れないことを保証
 * プロファイル不変条件: FAST/PRECISE の関係性を検証
 */

import { describe, expect, test } from "vitest";

import { ASPIRATION_WIDTHS } from "../search/techniques";
import {
  REVIEW_PROFILE_FAST,
  REVIEW_PROFILE_PRECISE,
  REVIEW_SEARCH_PARAMS,
} from "./reviewConstants";

describe("振り返りプロファイル不変条件", () => {
  test("FAST の maxNodes は PRECISE 以上", () => {
    expect(REVIEW_PROFILE_FAST.maxNodes).toBeGreaterThanOrEqual(
      REVIEW_PROFILE_PRECISE.maxNodes,
    );
  });

  test("FAST は timeLimit を持つ", () => {
    expect(REVIEW_PROFILE_FAST.timeLimit).toBeDefined();
  });

  test("PRECISE は timeLimit を持たない", () => {
    expect(REVIEW_PROFILE_PRECISE.timeLimit).toBeUndefined();
  });

  test("FAST は PV 検証無効", () => {
    expect(REVIEW_PROFILE_FAST.enablePVVerification).toBe(false);
  });

  test("PRECISE は PV 検証有効", () => {
    expect(REVIEW_PROFILE_PRECISE.enablePVVerification).toBe(true);
  });

  test("FAST は TT クリアする", () => {
    expect(REVIEW_PROFILE_FAST.clearTT).toBe(true);
  });

  test("PRECISE は TT 保持する", () => {
    expect(REVIEW_PROFILE_PRECISE.clearTT).toBe(false);
  });

  test("共通パラメータ depth は 8", () => {
    expect(REVIEW_SEARCH_PARAMS.depth).toBe(8);
  });
});

describe("境界の防壁: 対局CPUへの影響がないこと", () => {
  test("ASPIRATION_WIDTHS は段階的拡大を持つ", () => {
    expect(ASPIRATION_WIDTHS.length).toBeGreaterThan(1);
  });

  test("ASPIRATION_WIDTHS の初期幅は 75", () => {
    expect(ASPIRATION_WIDTHS[0]).toBe(75);
  });

  test("PRECISE プロファイルのみ aspirationWidths を持つ", () => {
    expect(REVIEW_PROFILE_PRECISE.aspirationWidths).toBeDefined();
    expect(REVIEW_PROFILE_FAST.aspirationWidths).toBeUndefined();
  });
});
