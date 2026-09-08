/**
 * evalParams.ts の名前→id 表（legacy 9 + prospect 34）と parseWeightOverrides の規約。
 * wasm との照合は evalParams.wasm.test.ts。
 */
import { describe, expect, it } from "vitest";

import {
  EVAL_PARAM_DEFAULTS,
  EVAL_PARAM_IDS,
  PROSPECT_CATEGORIES,
  PROSPECT_PARAM_ID_BASE,
  parseWeightOverrides,
} from "./evalParams.ts";

describe("EVAL_PARAM_IDS", () => {
  it("prospect id は base + cat*2 + turn（WAIT=0, TURN=1）で生成される", () => {
    expect(PROSPECT_PARAM_ID_BASE).toBe(100);
    expect(PROSPECT_CATEGORIES).toHaveLength(17);
    expect(EVAL_PARAM_IDS.PROSPECT_NONE_WAIT).toBe(100);
    expect(EVAL_PARAM_IDS.PROSPECT_NONE_TURN).toBe(101);
    expect(EVAL_PARAM_IDS.PROSPECT_SOLO_F3_TURN).toBe(100 + 7 * 2 + 1);
    expect(EVAL_PARAM_IDS.PROSPECT_WIN_TURN).toBe(133);
  });

  it("legacy 9 + prospect 34 = 43 キーで id は相異なる", () => {
    const ids = Object.values(EVAL_PARAM_IDS);
    expect(ids).toHaveLength(43);
    expect(new Set(ids).size).toBe(43);
  });

  it("既定値表は legacy 9 個のみ（prospect の既定値は TS に複製しない）", () => {
    expect(Object.keys(EVAL_PARAM_DEFAULTS)).toHaveLength(9);
    for (const k of Object.keys(EVAL_PARAM_DEFAULTS)) {
      expect(k.startsWith("PROSPECT_")).toBe(false);
    }
  });
});

describe("parseWeightOverrides", () => {
  it("legacy と prospect のキーを受け付ける", () => {
    expect(
      parseWeightOverrides("OPEN_THREE:600, PROSPECT_FOUR_THREE_TURN:2000"),
    ).toEqual({ OPEN_THREE: 600, PROSPECT_FOUR_THREE_TURN: 2000 });
  });

  it("不明キーはキー数と --help への誘導で短く報告する（全列挙しない）", () => {
    let message = "";
    try {
      parseWeightOverrides("FOO:1");
    } catch (e: unknown) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain('"FOO"');
    expect(message).toContain("43");
    expect(message).toContain("--help");
    expect(message).not.toContain("LINE_POTENTIAL_1");
  });

  it("非数値はエラー", () => {
    expect(() => parseWeightOverrides("OPEN_THREE:x")).toThrow(/数値/);
  });
});
