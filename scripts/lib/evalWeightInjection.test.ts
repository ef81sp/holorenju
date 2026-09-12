/**
 * applyEvalWeights（cpu-bridge-worker が使う eval 重み注入）の規約:
 * setEvalParam 後に getEvalParam で読み戻し、不一致なら throw する
 * （prospect ルーティング前の古い wasm では id>=100 が無音で捨てられるため）。
 */
import { describe, expect, it, vi } from "vitest";

import { EVAL_PARAM_IDS } from "./evalParams.ts";
import { applyEvalWeights } from "./evalWeightInjection.ts";

interface FakeWasm {
  store: Map<number, number>;
  resetEvalParams: ReturnType<typeof vi.fn<() => void>>;
  setEvalParam: ReturnType<typeof vi.fn<(id: number, value: number) => void>>;
  getEvalParam: ReturnType<typeof vi.fn<(id: number) => number>>;
}

/** setEvalParam を記憶し getEvalParam で返す wasm もどき。acceptIds 外は無音で捨てる */
function fakeWasm(acceptIds?: Set<number>): FakeWasm {
  const store = new Map<number, number>();
  return {
    store,
    resetEvalParams: vi.fn(() => store.clear()),
    setEvalParam: vi.fn((id: number, value: number) => {
      if (acceptIds === undefined || acceptIds.has(id)) {
        store.set(id, value);
      }
    }),
    getEvalParam: vi.fn((id: number) => store.get(id) ?? -2147483648),
  };
}

/** console.warn を黙らせて呼び出し回数だけ数える */
function spyWarn(): ReturnType<typeof vi.spyOn<Console, "warn">> {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

describe("applyEvalWeights", () => {
  it("resetEvalParams してから各キーを id に変換して setEvalParam する", () => {
    const wasm = fakeWasm();
    applyEvalWeights(wasm, { OPEN_THREE: 600, PROSPECT_FOUR_THREE_TURN: 2000 });
    expect(wasm.resetEvalParams).toHaveBeenCalledTimes(1);
    expect(wasm.store.get(EVAL_PARAM_IDS.OPEN_THREE)).toBe(600);
    expect(wasm.store.get(EVAL_PARAM_IDS.PROSPECT_FOUR_THREE_TURN)).toBe(2000);
  });

  it("読み戻しが一致しなければ throw する（id>=100 を捨てる古い wasm を検出）", () => {
    const wasm = fakeWasm(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]));
    expect(() =>
      applyEvalWeights(wasm, { PROSPECT_FOUR_THREE_TURN: 2000 }),
    ).toThrow(/PROSPECT_FOUR_THREE_TURN/);
  });

  it("不明キーは throw する", () => {
    const wasm = fakeWasm();
    expect(() => applyEvalWeights(wasm, { FOO: 1 })).toThrow(/FOO/);
  });

  it("setEvalParam の無い wasm は重み指定があれば warn のみ、無ければ何もしない", () => {
    const warn = spyWarn();
    try {
      expect(() => applyEvalWeights({}, { OPEN_THREE: 600 })).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      applyEvalWeights({}, undefined);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("getEvalParam の無い wasm（読み戻し不可）は warn して注入は続行する", () => {
    const warn = spyWarn();
    try {
      const wasm = fakeWasm();
      const { getEvalParam: _omit, ...noReadBack } = wasm;
      applyEvalWeights(noReadBack, { OPEN_THREE: 600 });
      expect(wasm.store.get(EVAL_PARAM_IDS.OPEN_THREE)).toBe(600);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("重み無し（null test）では reset だけ行い読み戻しはしない", () => {
    const wasm = fakeWasm();
    applyEvalWeights(wasm, {});
    expect(wasm.resetEvalParams).toHaveBeenCalledTimes(1);
    expect(wasm.setEvalParam).not.toHaveBeenCalled();
    expect(wasm.getEvalParam).not.toHaveBeenCalled();
  });
});
