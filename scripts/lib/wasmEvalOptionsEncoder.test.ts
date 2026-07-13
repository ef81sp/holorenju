/**
 * scripts/cpu-bridge-worker.ts の encodeEvalOptionsForWasm と
 * src/logic/cpu/wasm/searchEngine.ts の encodeEvalOptions が同一入力で
 * 同一ビットフラグを返すことを固定する（レイアウトB のエンコーダ一致テスト）。
 *
 * 2つのエンコーダは実装が分離している（cpu-bridge-worker.ts は commit-bench の
 * worktree 後方互換のため相対 import のみで解決できる scripts/lib/ 配下に
 * 抽出済み・`@/` エイリアス経由での共有は禁止）。ビットレイアウトのドリフトは
 * silent に「探索経路の eval_basis 等が配線されていない」事故になるため、
 * ここで機械的に固定する。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_EVAL_OPTIONS,
  FULL_EVAL_OPTIONS,
  type EvaluationOptions,
} from "@/logic/cpu/evaluation/patternScores";
import { encodeEvalOptions } from "@/logic/cpu/wasm/searchEngine";

import { encodeEvalOptionsForWasm } from "./wasmEvalOptionsEncoder";

type EvalBasis = EvaluationOptions["evalBasis"];

const EVAL_BASIS_VALUES: EvalBasis[] = [undefined, "legacy", "prospect"];
const MULTIPLIERS = [0, 0.5, 1.0];

/** DEFAULT/FULL の各ベースに evalBasis × multiplier の全組み合わせを掛けたマトリクス */
function buildMatrix(): { label: string; opts: EvaluationOptions }[] {
  const cases: { label: string; opts: EvaluationOptions }[] = [];

  for (const [baseLabel, base] of [
    ["DEFAULT", DEFAULT_EVAL_OPTIONS],
    ["FULL", FULL_EVAL_OPTIONS],
  ] as const) {
    for (const evalBasis of EVAL_BASIS_VALUES) {
      for (const singleFourPenaltyMultiplier of MULTIPLIERS) {
        cases.push({
          label: `${baseLabel}+evalBasis=${String(evalBasis)}+multiplier=${singleFourPenaltyMultiplier}`,
          opts: {
            ...base,
            enableSingleFourPenalty: true,
            singleFourPenaltyMultiplier,
            evalBasis,
          },
        });
      }
    }
  }

  // enableSingleFourPenalty=false（multiplier ビットが発火しない経路）も確認
  for (const evalBasis of EVAL_BASIS_VALUES) {
    cases.push({
      label: `DEFAULT+enableSingleFourPenalty=false+evalBasis=${String(evalBasis)}`,
      opts: { ...DEFAULT_EVAL_OPTIONS, evalBasis },
    });
  }

  return cases;
}

describe("wasmEvalOptionsEncoder: searchEngine.encodeEvalOptions との一致", () => {
  it.each(buildMatrix())("$label で同一flagsを返す", ({ opts }) => {
    expect(encodeEvalOptionsForWasm(opts)).toBe(encodeEvalOptions(opts));
  });

  it("evalBasis=prospect は他方のみと異なりbit18のみ差が出る（両者一致確認の補強）", () => {
    const base: EvaluationOptions = { ...DEFAULT_EVAL_OPTIONS };
    const legacyFlags = encodeEvalOptions(base);
    const prospectFlags = encodeEvalOptions({ ...base, evalBasis: "prospect" });

    expect(encodeEvalOptionsForWasm(base)).toBe(legacyFlags);
    expect(encodeEvalOptionsForWasm({ ...base, evalBasis: "prospect" })).toBe(
      prospectFlags,
    );

    expect(prospectFlags ^ legacyFlags).toBe(1 << 18);
  });
});
