/**
 * ハング中の bridge worker の「生存信号」（#128）。
 *
 * ハングした worker はメッセージに応答できないが、**完全に止まっているとは限らない**。
 * wasm 探索は時間制限を判定するたびに JS の `getTimestampMsExternal` を呼び返す
 * （zig 側の vcf/vct/quiescence/minimax/search の各所）。したがって、その呼び出しを
 * `SharedArrayBuffer` + `Atomics` で記録しておけば、メインスレッドは worker に
 * 問い合わせることなく
 *
 *   - 時間チェックが今も進んでいる → **探索が走り続けている**（時間制限が効いていない）
 *   - 時間チェックが止まっている   → 探索ループの外で固まっている / スレッドが止まった
 *
 * を区別できる。Zig 側は無改造（import する関数を JS 側で包むだけ）。
 *
 * バッファ表現（Int32Array 4 スロット）:
 *   [0] 時間チェック呼び出し回数（Atomics.add）
 *   [1] 直近の時間チェック時刻（epochBase からの経過 ms, Atomics.store）
 *   [2] 現在処理中の requestId（Atomics.store）
 *   [3] 予約
 *
 * 時刻を epoch そのものではなく `Date.now() - epochBase` で持つのは、Int32 に収める
 * ため（int32 上限 ≈ 24 日ぶんの ms なのでベンチの実行時間には十分）。epochBase は
 * バッファ生成時の `Date.now()` で、workerData 経由で worker と共有する。
 */

export const LIVENESS_SLOT_COUNT = 4;

export const LIVENESS_IDX = {
  timeCheckCount: 0,
  lastCheckMs: 1,
  requestId: 2,
} as const;

/** worker 起動時に渡す生存信号の共有バッファ一式 */
export interface LivenessChannel {
  buffer: SharedArrayBuffer;
  /** `Date.now() - epochBase` で ms を持つための基準 epoch */
  epochBase: number;
}

export function createLivenessChannel(): LivenessChannel {
  return {
    buffer: new SharedArrayBuffer(LIVENESS_SLOT_COUNT * 4),
    epochBase: Date.now(),
  };
}

/** ダンプに載せる生存信号の診断結果 */
export interface HangLiveness {
  /** worker 起動からの時間チェック回数 */
  timeCheckCount: number;
  /** 直近の時間チェック時刻（ISO8601）。一度も呼ばれていなければ undefined */
  lastTimeCheckAt?: string;
  /** ハング検出時点から見た経過 ms */
  msSinceLastTimeCheck?: number;
  /** worker が最後に受け取った requestId */
  requestId: number;
  /** サンプリング間に時間チェックが進んだ回数（0 なら探索ループが回っていない） */
  timeCheckDeltaDuringSample: number;
  sampleWindowMs: number;
  /**
   * 判定:
   * - `searching`: 時間チェックが進行中＝wasm 探索が走り続けている（時間制限が効いていない疑い）
   * - `stalled`: 時間チェックが進んでいない＝探索ループの外で停止している疑い
   * - `never-started`: 一度も時間チェックが呼ばれていない
   * - `unavailable`: 生存信号バッファが無い（古い worker / 未配線）
   */
  verdict: "searching" | "stalled" | "never-started" | "unavailable";
}

// ============================================================================
// worker 側
// ============================================================================

/**
 * wasm の `env.getTimestampMsExternal` を包み、呼び出しのたびに生存信号を更新する。
 * 戻り値は元の実装と同じ「performance.now() の ms」。
 */
export function createTimestampProbe(
  channel: LivenessChannel | undefined,
  now: () => number = () => performance.now(),
): () => number {
  if (!channel) {
    return () => Math.round(now());
  }
  const view = new Int32Array(channel.buffer);
  const { epochBase } = channel;
  return () => {
    const value = Math.round(now());
    Atomics.add(view, LIVENESS_IDX.timeCheckCount, 1);
    Atomics.store(view, LIVENESS_IDX.lastCheckMs, Date.now() - epochBase);
    return value;
  };
}

/** worker が着手要求を受け取ったときに、処理中の requestId を記録する。 */
export function markLivenessRequest(
  channel: LivenessChannel | undefined,
  requestId: number,
): void {
  if (!channel) {
    return;
  }
  const view = new Int32Array(channel.buffer);
  Atomics.store(view, LIVENESS_IDX.requestId, requestId);
}

// ============================================================================
// メインスレッド側
// ============================================================================

interface LivenessReading {
  timeCheckCount: number;
  lastCheckMs: number;
  requestId: number;
}

export function readLiveness(channel: LivenessChannel): LivenessReading {
  const view = new Int32Array(channel.buffer);
  return {
    timeCheckCount: Atomics.load(view, LIVENESS_IDX.timeCheckCount),
    lastCheckMs: Atomics.load(view, LIVENESS_IDX.lastCheckMs),
    requestId: Atomics.load(view, LIVENESS_IDX.requestId),
  };
}

const DEFAULT_SAMPLE_WINDOW_MS = 250;

/**
 * 生存信号を 2 回サンプリングして、探索ループが回っているかを判定する。
 * ハング検出時（GameHangError を作る直前）に呼ぶ。
 */
export async function diagnoseLiveness(
  channel: LivenessChannel | undefined,
  sampleWindowMs: number = DEFAULT_SAMPLE_WINDOW_MS,
): Promise<HangLiveness> {
  if (!channel) {
    return {
      timeCheckCount: 0,
      requestId: 0,
      timeCheckDeltaDuringSample: 0,
      sampleWindowMs: 0,
      verdict: "unavailable",
    };
  }
  const first = readLiveness(channel);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, sampleWindowMs);
  });
  const second = readLiveness(channel);
  const delta = second.timeCheckCount - first.timeCheckCount;

  if (second.timeCheckCount === 0) {
    return {
      timeCheckCount: 0,
      requestId: second.requestId,
      timeCheckDeltaDuringSample: 0,
      sampleWindowMs,
      verdict: "never-started",
    };
  }
  const lastTimeCheckEpoch = channel.epochBase + second.lastCheckMs;
  return {
    timeCheckCount: second.timeCheckCount,
    lastTimeCheckAt: new Date(lastTimeCheckEpoch).toISOString(),
    msSinceLastTimeCheck: Date.now() - lastTimeCheckEpoch,
    requestId: second.requestId,
    timeCheckDeltaDuringSample: delta,
    sampleWindowMs,
    verdict: delta > 0 ? "searching" : "stalled",
  };
}
