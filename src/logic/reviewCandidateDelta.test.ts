/**
 * 候補手グリッドのスコア差表示（review-multipv-2026-09-06.md §2.5 経路 3）
 *
 * 真値でない候補（fail-low の境界値＝上限）は delta に「≤」を付ける。
 */

import { describe, expect, it } from "vitest";

import { formatCandidateDelta } from "./reviewCandidateDelta";

describe("formatCandidateDelta", () => {
  it("真値の delta はそのまま", () => {
    expect(formatCandidateDelta(0, true)).toBe("±0");
    expect(formatCandidateDelta(-1234, true)).toBe("-1,234");
    expect(formatCandidateDelta(250, true)).toBe("250");
  });

  it("境界値（scoreExact=false / 省略）の delta には ≤ を付ける", () => {
    expect(formatCandidateDelta(0, false)).toBe("≤±0");
    expect(formatCandidateDelta(-1234, false)).toBe("≤-1,234");
    expect(formatCandidateDelta(-5, undefined)).toBe("≤-5");
  });
});
