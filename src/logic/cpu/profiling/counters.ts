/**
 * プロファイリング用カウンター
 *
 * 探索中の各種処理の呼び出し回数を計測するためのグローバルカウンター
 */

/**
 * プロファイリングカウンター
 */
export interface ProfilingCounters {
  /** 禁手判定回数 */
  forbiddenCheckCalls: number;
  /** 盤面コピー回数 */
  boardCopies: number;
  /** 脅威検出回数 */
  threatDetectionCalls: number;
  /** 評価関数呼び出し回数 */
  evaluationCalls: number;
}

/**
 * グローバルカウンター
 */
let counters: ProfilingCounters = {
  forbiddenCheckCalls: 0,
  boardCopies: 0,
  threatDetectionCalls: 0,
  evaluationCalls: 0,
};

/**
 * カウンターをリセット
 */
export function resetCounters(): void {
  counters = {
    forbiddenCheckCalls: 0,
    boardCopies: 0,
    threatDetectionCalls: 0,
    evaluationCalls: 0,
  };
}

/**
 * 現在のカウンター値を取得
 */
export function getCounters(): Readonly<ProfilingCounters> {
  return { ...counters };
}

/**
 * 禁手判定カウンターをインクリメント
 */
export function incrementForbiddenCheckCalls(): void {
  counters.forbiddenCheckCalls++;
}

/**
 * 盤面コピーカウンターをインクリメント
 */
export function incrementBoardCopies(): void {
  counters.boardCopies++;
}

/**
 * 脅威検出カウンターをインクリメント
 */
export function incrementThreatDetectionCalls(): void {
  counters.threatDetectionCalls++;
}

/**
 * 評価関数カウンターをインクリメント
 */
export function incrementEvaluationCalls(): void {
  counters.evaluationCalls++;
}
