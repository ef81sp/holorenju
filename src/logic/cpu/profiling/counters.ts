/**
 * プロファイリング用カウンター
 *
 * 探索中の各種処理の呼び出し回数・累積時間を計測するためのグローバルカウンター
 */

/**
 * タイミング計測エントリ
 */
export interface TimingEntry {
  /** 呼び出し回数 */
  calls: number;
  /** 累積時間 (ms) */
  totalMs: number;
}

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

  /** 関数別タイミング */
  timings: {
    generateSortedMoves: TimingEntry;
    hasImmediateThreat: TimingEntry;
    detectOpponentThreats: TimingEntry;
    evaluateBoard: TimingEntry;
    evaluatePosition: TimingEntry;
    threatProbe: TimingEntry;
  };
}

function emptyTimings(): ProfilingCounters["timings"] {
  return {
    generateSortedMoves: { calls: 0, totalMs: 0 },
    hasImmediateThreat: { calls: 0, totalMs: 0 },
    detectOpponentThreats: { calls: 0, totalMs: 0 },
    evaluateBoard: { calls: 0, totalMs: 0 },
    evaluatePosition: { calls: 0, totalMs: 0 },
    threatProbe: { calls: 0, totalMs: 0 },
  };
}

/**
 * グローバルカウンター
 */
let counters: ProfilingCounters = {
  forbiddenCheckCalls: 0,
  boardCopies: 0,
  threatDetectionCalls: 0,
  evaluationCalls: 0,
  timings: emptyTimings(),
};

/**
 * プロファイリング有効フラグ
 *
 * false の場合、タイミング計測をスキップしてオーバーヘッドを回避
 */
let profilingEnabled = false;

/**
 * プロファイリングの有効/無効を設定
 */
export function setProfilingEnabled(enabled: boolean): void {
  profilingEnabled = enabled;
}

/**
 * プロファイリングが有効かどうか
 */
export function isProfilingEnabled(): boolean {
  return profilingEnabled;
}

/**
 * カウンターをリセット
 */
export function resetCounters(): void {
  counters = {
    forbiddenCheckCalls: 0,
    boardCopies: 0,
    threatDetectionCalls: 0,
    evaluationCalls: 0,
    timings: emptyTimings(),
  };
}

/**
 * 現在のカウンター値を取得
 */
export function getCounters(): Readonly<ProfilingCounters> {
  return { ...counters, timings: { ...counters.timings } };
}

/**
 * タイミング計測開始
 *
 * @returns 開始タイムスタンプ（profilingEnabled=false の場合は 0）
 */
export function startTiming(): number {
  if (!profilingEnabled) {
    return 0;
  }
  return performance.now();
}

/**
 * タイミング計測終了・記録
 */
export function recordTiming(
  key: keyof ProfilingCounters["timings"],
  startTime: number,
): void {
  if (!profilingEnabled) {
    return;
  }
  const entry = counters.timings[key];
  entry.calls++;
  entry.totalMs += performance.now() - startTime;
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
