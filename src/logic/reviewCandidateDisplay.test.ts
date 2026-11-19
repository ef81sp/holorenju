/**
 * 振り返り画面 候補手グリッドの表示ルール
 * （docs/plans/review-right-panel-redesign-2026-11-19.md）
 */

import { describe, expect, it } from "vitest";

import {
  MAX_DISPLAY_CANDIDATES,
  gaugeRatioFromDelta,
  gradeFromDelta,
  selectDisplayCandidates,
} from "./reviewCandidateDisplay";

describe("gaugeRatioFromDelta", () => {
  it("最善と同点は満タン（1）", () => {
    expect(gaugeRatioFromDelta(0)).toBe(1);
  });

  it("差に比例して短くなり、疑問手の境界（差400）で 0 になる", () => {
    expect(gaugeRatioFromDelta(-100)).toBeCloseTo(0.75);
    expect(gaugeRatioFromDelta(-200)).toBeCloseTo(0.5);
    expect(gaugeRatioFromDelta(-400)).toBe(0);
  });

  it("差400を超えても 0 のまま（底打ち）", () => {
    expect(gaugeRatioFromDelta(-2500)).toBe(0);
  });

  it("最善より高い delta は満タンに丸める", () => {
    expect(gaugeRatioFromDelta(120)).toBe(1);
  });
});

describe("gradeFromDelta", () => {
  it("最善と同点は S", () => {
    expect(gradeFromDelta(0)).toBe("S");
  });

  it("品質判定と同じしきい値で A / B / C に分ける", () => {
    expect(gradeFromDelta(-1)).toBe("A");
    expect(gradeFromDelta(-150)).toBe("A");
    expect(gradeFromDelta(-151)).toBe("B");
    expect(gradeFromDelta(-400)).toBe("B");
    expect(gradeFromDelta(-401)).toBe("C");
    expect(gradeFromDelta(-2501)).toBe("C");
  });

  it("最善より高い delta（探索の非単調性）は S に丸める", () => {
    expect(gradeFromDelta(120)).toBe("S");
  });
});

describe("selectDisplayCandidates", () => {
  interface Item {
    id: number;
    required?: boolean;
  }
  const isRequired = (item: Item): boolean => item.required === true;
  const ids = (items: Item[]): number[] => items.map((i) => i.id);

  it("表示上限は 3 件", () => {
    expect(MAX_DISPLAY_CANDIDATES).toBe(3);
  });

  it("上限以下ならそのまま返す", () => {
    const items: Item[] = [{ id: 1 }, { id: 2, required: true }];
    expect(ids(selectDisplayCandidates(items, isRequired))).toEqual([1, 2]);
  });

  it("必須がなければ上位 3 件", () => {
    const items: Item[] = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    expect(ids(selectDisplayCandidates(items, isRequired))).toEqual([1, 2, 3]);
  });

  it("圏外の必須（自分の手）を含め、残りを上位から補う", () => {
    const items: Item[] = [
      { id: 1, required: true },
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5, required: true },
    ];
    expect(ids(selectDisplayCandidates(items, isRequired))).toEqual([1, 2, 5]);
  });

  it("必須が先頭以外にあっても元の並び順を保つ", () => {
    const items: Item[] = [
      { id: 1 },
      { id: 2 },
      { id: 3, required: true },
      { id: 4 },
      { id: 5, required: true },
    ];
    expect(ids(selectDisplayCandidates(items, isRequired))).toEqual([1, 3, 5]);
  });

  it("上限は引数で変えられる", () => {
    const items: Item[] = [{ id: 1 }, { id: 2 }, { id: 3, required: true }];
    expect(ids(selectDisplayCandidates(items, isRequired, 2))).toEqual([1, 3]);
  });
});
