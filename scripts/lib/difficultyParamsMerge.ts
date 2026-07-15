/**
 * DifficultyParams への customParams 適用ルール（SSoT）。
 *
 * cpu-bridge-worker.ts の loadDifficultyParams が使う「customParams が未指定なら
 * baseParams をそのまま、指定されていれば evaluationOptions のみ浅くマージし
 * それ以外のトップレベルフィールドは丸ごと上書き」というマージ規則を独立関数として
 * 抽出したもの。worker モジュールは import 時に workerData に依存するため
 * vitest から直接 import できず単体テストできない。マージ規則をここに切り出すことで
 * evalBasis 等の customParams.evaluationOptions が正しく反映されることを
 * worker を経由せずに検証できる。
 */
import type { DifficultyParams } from "../../src/types/cpu.ts";

export function mergeDifficultyParams(
  baseParams: DifficultyParams,
  customParams?: Partial<DifficultyParams>,
): DifficultyParams {
  if (!customParams) {
    return baseParams;
  }
  return {
    ...baseParams,
    ...customParams,
    evaluationOptions: {
      ...baseParams.evaluationOptions,
      ...customParams.evaluationOptions,
    },
  };
}
