/**
 * eval 重みの実行時注入（weight-bench → cpu-bridge-worker）。
 *
 * `resetEvalParams()` でクリーンな既定に戻してから、名前キーを EVAL_PARAM_IDS で id に
 * 変換して `setEvalParam` する。注入後は `getEvalParam(id)` で **読み戻して一致を検証**し、
 * 不一致なら throw する（prospect ルーティング前の古い wasm では id>=100 が無音で
 * 捨てられ、「既定 vs 既定」を測ってしまう事故を防ぐ）。
 *
 * docs/plans/strength-screen-2026-09-08.md §2 T1-4。
 */
import { EVAL_PARAM_IDS } from "./evalParams.ts";

/** 注入に使う wasm export（古い wasm には無い＝すべて optional）。 */
export interface EvalParamInjectable {
  setEvalParam?: (id: number, value: number) => void;
  getEvalParam?: (id: number) => number;
  resetEvalParams?: () => void;
}

const LOG_PREFIX = "[cpu-bridge-worker]";

export function applyEvalWeights(
  wasm: EvalParamInjectable,
  weights: Record<string, number> | undefined,
): void {
  const entries = Object.entries(weights ?? {});
  if (
    typeof wasm.setEvalParam !== "function" ||
    typeof wasm.resetEvalParams !== "function"
  ) {
    if (entries.length > 0) {
      console.warn(
        `${LOG_PREFIX} この wasm は setEvalParam 非対応。evalWeights を無視します。`,
      );
    }
    return;
  }
  wasm.resetEvalParams();
  if (entries.length === 0) {
    return;
  }
  const canReadBack = typeof wasm.getEvalParam === "function";
  if (!canReadBack) {
    console.warn(
      `${LOG_PREFIX} この wasm は getEvalParam 非対応。注入値の読み戻し検証をスキップします。`,
    );
  }
  for (const [name, value] of entries) {
    const id = (EVAL_PARAM_IDS as Record<string, number>)[name];
    if (id === undefined) {
      throw new Error(`${LOG_PREFIX} 不明な eval 重みキー: ${name}`);
    }
    wasm.setEvalParam(id, value);
    if (canReadBack) {
      const actual = wasm.getEvalParam!(id);
      if (actual !== value) {
        throw new Error(
          `${LOG_PREFIX} eval 重みの注入が反映されていません: ${name}(id=${id}) set=${value} readback=${actual}。この wasm は id=${id} を受け付けない可能性があります（prospect ルーティング前の古いビルド等）`,
        );
      }
    }
  }
}
