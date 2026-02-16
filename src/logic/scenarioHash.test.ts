import { describe, expect, it } from "vitest";

import type { Scenario } from "@/types/scenario";

import { computeStructureHash } from "./scenarioHash";

/** computeStructureHash は id と type のみ参照するため最小限のスタブで十分 */
function makeScenario(
  sections: { id: string; type: "demo" | "question" }[],
): Pick<Scenario, "sections"> {
  return {
    sections: sections as unknown as Scenario["sections"],
  };
}

describe("computeStructureHash", () => {
  it("同じ構造のシナリオは同じハッシュを返す", () => {
    const a = makeScenario([
      { id: "s1", type: "demo" },
      { id: "s2", type: "question" },
    ]);
    const b = makeScenario([
      { id: "s1", type: "demo" },
      { id: "s2", type: "question" },
    ]);
    expect(computeStructureHash(a)).toBe(computeStructureHash(b));
  });

  it("セクション追加で異なるハッシュを返す", () => {
    const a = makeScenario([{ id: "s1", type: "demo" }]);
    const b = makeScenario([
      { id: "s1", type: "demo" },
      { id: "s2", type: "question" },
    ]);
    expect(computeStructureHash(a)).not.toBe(computeStructureHash(b));
  });

  it("セクション削除で異なるハッシュを返す", () => {
    const a = makeScenario([
      { id: "s1", type: "demo" },
      { id: "s2", type: "question" },
    ]);
    const b = makeScenario([{ id: "s1", type: "demo" }]);
    expect(computeStructureHash(a)).not.toBe(computeStructureHash(b));
  });

  it("セクションタイプ変更で異なるハッシュを返す", () => {
    const a = makeScenario([{ id: "s1", type: "demo" }]);
    const b = makeScenario([{ id: "s1", type: "question" }]);
    expect(computeStructureHash(a)).not.toBe(computeStructureHash(b));
  });

  it("セクション順序変更で異なるハッシュを返す", () => {
    const a = makeScenario([
      { id: "s1", type: "demo" },
      { id: "s2", type: "question" },
    ]);
    const b = makeScenario([
      { id: "s2", type: "question" },
      { id: "s1", type: "demo" },
    ]);
    expect(computeStructureHash(a)).not.toBe(computeStructureHash(b));
  });

  it("空セクション配列でもエラーなくハッシュを返す", () => {
    const scenario = makeScenario([]);
    expect(() => computeStructureHash(scenario)).not.toThrow();
    expect(typeof computeStructureHash(scenario)).toBe("string");
  });

  it("ハッシュは文字列で返される", () => {
    const scenario = makeScenario([{ id: "s1", type: "demo" }]);
    const hash = computeStructureHash(scenario);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});
