/**
 * Futility Pruning マージン計測
 *
 * 各深度で「静的評価 vs 実際の探索スコア」の差分（gain）を収集し、
 * 適切なマージン値を実証的に決定するためのデータを提供する。
 */

export interface FutilityGainSample {
  depth: number;
  /** max(0, 探索による改善量): max player は searchScore - staticEval, min player は staticEval - searchScore */
  gain: number;
}

let collector: FutilityGainSample[] | null = null;

/**
 * 計測開始（コレクターを初期化）
 */
export function startFutilityMeasurement(): void {
  collector = [];
}

/**
 * 計測停止し、収集データを返す
 */
export function stopFutilityMeasurement(): FutilityGainSample[] {
  const data = collector ?? [];
  collector = null;
  return data;
}

/**
 * 計測中かどうか
 */
export function isMeasuringFutility(): boolean {
  return collector !== null;
}

/**
 * gain サンプルを記録
 */
export function recordFutilityGain(depth: number, gain: number): void {
  collector?.push({ depth, gain });
}
