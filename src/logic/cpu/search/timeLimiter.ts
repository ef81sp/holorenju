/**
 * 時間制限コンテキスト
 *
 * VCF/VCT探索共通の時間制限・ノード数管理。
 */

/**
 * VCF/VCT共通の時間制限コンテキスト
 */
export interface TimeLimiter {
  startTime: number;
  timeLimit: number;
  /** 探索ノード数カウンタ（maxNodes と併用） */
  nodes?: number;
  /** ノード数上限（0 = 無制限） */
  maxNodes?: number;
  /** 親リミッター（VCT→VCF連携用: ノード数を親にも伝播し、親の制限も検査する） */
  parentLimiter?: TimeLimiter;
}

/**
 * 時間制限またはノード数上限を超過しているかチェック
 *
 * parentLimiter が設定されている場合、親の制限も検査する。
 */
export function isTimeExceeded(limiter: TimeLimiter): boolean {
  if (
    limiter.maxNodes !== undefined &&
    limiter.maxNodes > 0 &&
    limiter.nodes !== undefined &&
    limiter.nodes >= limiter.maxNodes
  ) {
    return true;
  }
  if (performance.now() - limiter.startTime >= limiter.timeLimit) {
    return true;
  }
  if (limiter.parentLimiter) {
    return isTimeExceeded(limiter.parentLimiter);
  }
  return false;
}

/**
 * ノードカウンタをインクリメント
 *
 * parentLimiter が設定されている場合、親のノード数もインクリメントする。
 */
export function incrementNodes(limiter: TimeLimiter): void {
  if (limiter.nodes !== undefined) {
    limiter.nodes++;
  }
  if (limiter.parentLimiter) {
    incrementNodes(limiter.parentLimiter);
  }
}
