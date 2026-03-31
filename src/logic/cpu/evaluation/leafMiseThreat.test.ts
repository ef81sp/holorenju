/**
 * 末端ミセ手脅威推定のテスト
 */

import { describe, expect, it } from "vitest";

import { estimateMiseOpportunity } from "./leafMiseThreat";
import { PATTERN_SCORES } from "./patternScores";

describe("estimateMiseOpportunity", () => {
  it("四と活三の両方がある場合はミセ機会あり", () => {
    expect(
      estimateMiseOpportunity(PATTERN_SCORES.FOUR, PATTERN_SCORES.OPEN_THREE),
    ).toBe(true);
  });

  it("四のみ（活三なし）はミセ機会なし", () => {
    expect(estimateMiseOpportunity(PATTERN_SCORES.FOUR, 0)).toBe(false);
  });

  it("活三のみ（四なし）はミセ機会なし", () => {
    expect(estimateMiseOpportunity(0, PATTERN_SCORES.OPEN_THREE)).toBe(false);
  });

  it("両方ゼロはミセ機会なし", () => {
    expect(estimateMiseOpportunity(0, 0)).toBe(false);
  });

  it("複数方向の四と活三もミセ機会あり", () => {
    expect(
      estimateMiseOpportunity(
        PATTERN_SCORES.FOUR * 2,
        PATTERN_SCORES.OPEN_THREE * 2,
      ),
    ).toBe(true);
  });
});
