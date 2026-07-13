/**
 * EvaluationOptions（探索経路 = レイアウトB）→ WASM findBestMove 用ビットマスク。
 *
 * cpu-bridge-worker.ts はこのファイルを**相対パスで import**する（`@/` エイリアス経由の
 * import は禁止）。commit-bench 実行時、worker には過去コミットの worktree を指す
 * register-loader.mjs が `--import` される。`@/` エイリアスで src 配下の encoder を
 * 共有すると、その worktree の（古い）src に解決されてしまい、現行リポジトリの
 * ビットレイアウトと食い違う事故になる。scripts/lib/ 配下のファイルは常に現行
 * リポジトリのファイルとして解決されるため、相対 import であればこの事故が起きない。
 *
 * ただし `EvalBasis` 型（下記 import）は **type-only**（`import type`）なので実行時に
 * 消える。register-loader の worktree 張り替えは実行時の値解決にのみ影響するため、
 * 型だけを `@/` 経由で共有してもこの事故は起きない（値を import する場合と区別すること）。
 *
 * src/logic/cpu/wasm/searchEngine.ts の `encodeEvalOptions` と同じビットレイアウトを
 * 維持すること。等価性は scripts/lib/wasmEvalOptionsEncoder.test.ts で固定している。
 *
 * ビットレイアウト（u32）— Zig main.zig findBestMove と一致:
 *   bits 0-8:   position_eval.EvalOptions（ムーブオーダリング用フラグ）
 *   bits 9-16:  葉評価 single_four_penalty_multiplier
 *               （0=未指定→100、255=センチネル→0、1-254=そのまま）
 *   bit 17:     enable_leaf_mise（現在は未使用）
 *   bit 18:     eval_basis（evalBasis === "prospect" のとき1、それ以外0=legacy）
 */
import type { EvalBasis } from "@/logic/cpu/evaluation/patternScores";

export interface WasmEvalOptionsInput {
  enableMise?: boolean;
  enableForbiddenTrap?: boolean;
  enableMultiThreat?: boolean;
  enableCounterFour?: boolean;
  enableNullMovePruning?: boolean;
  enableFutilityPruning?: boolean;
  enableMandatoryDefense?: boolean;
  enableSingleFourPenalty?: boolean;
  singleFourPenaltyMultiplier?: number;
  enableMiseThreat?: boolean;
  enableDoubleThreeThreat?: boolean;
  enableForbiddenVulnerability?: boolean;
  evalBasis?: EvalBasis;
}

export function encodeEvalOptionsForWasm(opts: WasmEvalOptionsInput): number {
  const bits: boolean[] = [
    opts.enableMise ?? false,
    opts.enableForbiddenTrap ?? false,
    opts.enableMultiThreat ?? false,
    (opts.enableCounterFour ?? false) ||
      (opts.enableNullMovePruning ?? false) ||
      (opts.enableFutilityPruning ?? false),
    opts.enableMandatoryDefense ?? false,
    opts.enableSingleFourPenalty ?? false,
    opts.enableMiseThreat ?? false,
    opts.enableDoubleThreeThreat ?? false,
    opts.enableForbiddenVulnerability ?? false,
  ];
  let flags = bits.reduce((acc, bit, i) => acc + (bit ? 2 ** i : 0), 0);

  // bits 9-16: 葉評価 singleFourPenaltyMultiplier
  // センチネル規則（Zig main.zig findBestMove と対称）:
  //   enableSingleFourPenalty が false → 0（未指定 = デフォルト 100）
  //   multiplier === 0 → 255（センチネル: 完全ペナルティ）
  //   その他 → Math.round(m * 100)（1-254）
  if (opts.enableSingleFourPenalty) {
    const m = opts.singleFourPenaltyMultiplier ?? 1.0;
    const raw = m === 0 ? 255 : Math.round(m * 100);
    flags |= (raw & 0xff) << 9;
  }

  if (opts.evalBasis === "prospect") {
    flags |= 1 << 18;
  }

  return flags;
}
