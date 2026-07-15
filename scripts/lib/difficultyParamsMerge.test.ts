/**
 * mergeDifficultyParams のマージ規則を固定する（cpu-bridge-worker.ts loadDifficultyParams
 * の SSoT）。evalBasis 等 customParams.evaluationOptions が正しく反映されることの
 * ワイヤリング検証の一部（Gate 2 の silent 事故防止）。
 */
import { describe, expect, it } from "vitest";

import type { DifficultyParams } from "../../src/types/cpu.ts";

import { mergeDifficultyParams } from "./difficultyParamsMerge.ts";

function makeBaseParams(): DifficultyParams {
  return {
    depth: 4,
    timeLimit: 5000,
    randomFactor: 0.02,
    maxNodes: 100000,
    evaluationOptions: {
      enableFukumi: true,
      enableMise: true,
    } as DifficultyParams["evaluationOptions"],
    scoreThreshold: 100,
  };
}

describe("mergeDifficultyParams", () => {
  it("customParams 未指定なら baseParams をそのまま返す（後方互換）", () => {
    const base = makeBaseParams();
    expect(mergeDifficultyParams(base, undefined)).toBe(base);
  });

  it("evaluationOptions は浅くマージされ、base 側のキーは保持される", () => {
    const base = makeBaseParams();
    const merged = mergeDifficultyParams(base, {
      evaluationOptions: { evalBasis: "prospect" } as Partial<
        DifficultyParams["evaluationOptions"]
      >,
    });

    expect(merged.evaluationOptions.evalBasis).toBe("prospect");
    // base 側の他キーは失われない
    expect(merged.evaluationOptions.enableFukumi).toBe(true);
    expect(merged.evaluationOptions.enableMise).toBe(true);
  });

  it("evaluationOptions 以外のトップレベルフィールドは customParams が丸ごと上書きする", () => {
    const base = makeBaseParams();
    const merged = mergeDifficultyParams(base, { randomFactor: 0.5 });

    expect(merged.randomFactor).toBe(0.5);
    expect(merged.depth).toBe(base.depth);
    // evaluationOptions は customParams 側で未指定なら base のまま
    expect(merged.evaluationOptions).toEqual(base.evaluationOptions);
  });

  it("evalBasis 未指定の customParams（例: randomFactor のみ）は evalBasis を legacy のまま保つ", () => {
    const base = makeBaseParams();
    const merged = mergeDifficultyParams(base, { randomFactor: 0.1 });

    expect(merged.evaluationOptions.evalBasis).toBeUndefined();
  });
});
