/**
 * 決定的探索モード（bench-fixed-nodes-2026-09-06.md §2.5「非対応の検出」）の
 * 対応可否を wasm export から判定する純関数。
 *
 * bridge worker は workerData 依存で vitest から import できないため、判定だけを
 * ここに切り出してテストする。要求されたのに非対応なら worker は **中止**する
 * （黙って時間モードで走ると「決定的なつもりの結果」が混入する）。
 */
import { SEARCH_FEATURE_DETERMINISTIC } from "./wasmSearchStats.ts";

/** 判定に必要な export だけを持つ最小インターフェース（wasm 無しなら null） */
export interface DeterministicExports {
  setDeterministicMode?: (enabled: number) => void;
  getSearchFeatures?: () => number;
}

/** `getSearchFeatures()` の値。export が無い旧 wasm / wasm 無しは undefined。 */
export function readSearchFeatures(
  wasm: DeterministicExports | null,
): number | undefined {
  if (!wasm || typeof wasm.getSearchFeatures !== "function") {
    return undefined;
  }
  return wasm.getSearchFeatures() >>> 0;
}

export type DeterministicSupport = { ok: true } | { ok: false; reason: string };

/**
 * `deterministic` 要求時に、wasm が `setDeterministicMode` を export し
 * `getSearchFeatures() & 1` が立っていることを確認する。未要求なら常に ok。
 */
export function checkDeterministicSupport(
  wasm: DeterministicExports | null,
  requested: boolean,
): DeterministicSupport {
  if (!requested) {
    return { ok: true };
  }
  if (!wasm) {
    return {
      ok: false,
      reason:
        "決定的モードは wasm 専用です（TS フォールバックでは時間管理を切り替えられない）",
    };
  }
  if (typeof wasm.setDeterministicMode !== "function") {
    return {
      ok: false,
      reason:
        "この wasm は setDeterministicMode を export していません（bench-fixed-nodes PR より前のコミット）",
    };
  }
  if (typeof wasm.getSearchFeatures !== "function") {
    return {
      ok: false,
      reason: "この wasm は getSearchFeatures を export していません",
    };
  }
  const features = wasm.getSearchFeatures() >>> 0;
  if ((features & SEARCH_FEATURE_DETERMINISTIC) === 0) {
    return {
      ok: false,
      reason: `getSearchFeatures() の bit0（deterministic 対応）が立っていません (features=${features})`,
    };
  }
  return { ok: true };
}
