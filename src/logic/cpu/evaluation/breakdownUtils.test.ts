/**
 * breakdownUtils のテスト
 *
 * miseType に応じたラベル切替を検証
 */

import { describe, expect, it } from "vitest";

import { getNonZeroBreakdown } from "./breakdownUtils";
import { emptyPatternBreakdown, type ScoreBreakdown } from "./patternScores";

function createBreakdown(
  overrides: Partial<ScoreBreakdown> = {},
): ScoreBreakdown {
  return {
    pattern: emptyPatternBreakdown(),
    defense: emptyPatternBreakdown(),
    fourThree: 0,
    fukumi: 0,
    mise: 0,
    miseType: "none",
    center: 0,
    multiThreat: 0,
    defenseMultiThreat: 0,
    singleFourPenalty: 0,
    forbiddenTrap: 0,
    forbiddenVulnerability: 0,
    ...overrides,
  };
}

describe("getNonZeroBreakdown miseType label", () => {
  it('miseType: "mise" + mise: 1000 -> label "ミセ手"', () => {
    const breakdown = createBreakdown({ mise: 1000, miseType: "mise" });
    const result = getNonZeroBreakdown(breakdown);
    const miseItem = result.bonuses.find((b) => b.key === "mise");
    expect(miseItem).toBeDefined();
    expect(miseItem?.label).toBe("ミセ手");
    expect(miseItem?.value).toBe(1000);
  });

  it('miseType: "double-mise" + mise: 4000 -> label "両ミセ"', () => {
    const breakdown = createBreakdown({
      mise: 4000,
      miseType: "double-mise",
    });
    const result = getNonZeroBreakdown(breakdown);
    const miseItem = result.bonuses.find((b) => b.key === "mise");
    expect(miseItem).toBeDefined();
    expect(miseItem?.label).toBe("両ミセ");
    expect(miseItem?.value).toBe(4000);
  });

  it("mise: 0 -> bonuses に含まれない", () => {
    const breakdown = createBreakdown({ mise: 0, miseType: "none" });
    const result = getNonZeroBreakdown(breakdown);
    const miseItem = result.bonuses.find((b) => b.key === "mise");
    expect(miseItem).toBeUndefined();
  });
});
