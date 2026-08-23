/**
 * メインスレッドのイベントループ遅延・時計ずれサンプラ（#128）。
 *
 * 実ダンプ g172 は「局開始からの経過時間が、各手の思考時間合計 + タイムアウト値より
 * **38.7 分**も長い」という形をしていた。これは worker の探索が長引いたのではなく、
 * **メインスレッド側が止まっていた**（イベントループ飽和 / プロセス・マシンの
 * サスペンド）ことを示唆する。worker 側の計測だけでは区別できないため、メイン
 * スレッド自身の健康状態を常時サンプリングしてハングダンプに載せる。
 *
 * 2 つの指標を取る:
 * - **timer lag**: `setInterval(…, 1000)` の予定発火と実発火の差。イベントループが
 *   詰まっている（同期処理で専有されている）と伸びる。
 * - **clock skew**: `Date.now()`（壁時計）と `performance.now()`（単調時計）の差の
 *   推移。マシンのサスペンド／レジュームで**跳ぶ**。timer lag と組み合わせると
 *   「忙しかった」のか「眠っていた」のかを切り分けられる。
 */

/** 1 サンプル */
export interface EventLoopSample {
  /** サンプル時刻（ISO8601） */
  at: string;
  /** タイマの予定発火からの遅れ ms（0 に近いほど健康） */
  timerLagMs: number;
  /** `Date.now() - (基準 + performance.now())` の値 ms。跳びがサスペンドの兆候 */
  clockSkewMs: number;
}

/** ダンプに載せるスナップショット */
export interface EventLoopSnapshot {
  /** サンプラが動いていたか（未起動なら false で samples は空） */
  running: boolean;
  intervalMs: number;
  /** 直近 N サンプル（古→新） */
  samples: EventLoopSample[];
  /** 観測した最大 timer lag */
  maxTimerLagMs: number;
  /**
   * 隣接サンプル間の clockSkew の最大跳び幅。
   * 数百 ms を超えるならサスペンド／時計調整を疑う。
   */
  maxClockSkewJumpMs: number;
}

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_SAMPLE_LIMIT = 60;

interface SamplerState {
  timer: ReturnType<typeof setInterval>;
  intervalMs: number;
  limit: number;
  samples: EventLoopSample[];
  skewBase: number;
  expectedAt: number;
}

let state: SamplerState | null = null;

/**
 * サンプリングを開始する。多重起動は無視（最初の設定が生きる）。
 * タイマは `unref()` するのでプロセス終了を妨げない。
 */
export function startEventLoopSampler(
  intervalMs: number = DEFAULT_INTERVAL_MS,
  limit: number = DEFAULT_SAMPLE_LIMIT,
): void {
  if (state) {
    return;
  }
  const skewBase = Date.now() - performance.now();
  const local: SamplerState = {
    timer: setInterval(() => {
      const now = performance.now();
      const sample: EventLoopSample = {
        at: new Date().toISOString(),
        timerLagMs: Math.round(now - local.expectedAt),
        clockSkewMs: Math.round(
          Date.now() - performance.now() - local.skewBase,
        ),
      };
      local.expectedAt = now + intervalMs;
      local.samples.push(sample);
      if (local.samples.length > local.limit) {
        local.samples.shift();
      }
    }, intervalMs),
    intervalMs,
    limit: Math.max(1, limit),
    samples: [],
    skewBase,
    expectedAt: performance.now() + intervalMs,
  };
  local.timer.unref();
  state = local;
}

export function stopEventLoopSampler(): void {
  if (!state) {
    return;
  }
  clearInterval(state.timer);
  state = null;
}

/** 現在のスナップショットを返す（未起動なら running=false の空スナップショット）。 */
export function snapshotEventLoop(): EventLoopSnapshot {
  if (!state) {
    return {
      running: false,
      intervalMs: 0,
      samples: [],
      maxTimerLagMs: 0,
      maxClockSkewJumpMs: 0,
    };
  }
  const samples = [...state.samples];
  let maxTimerLagMs = 0;
  let maxClockSkewJumpMs = 0;
  let previousSkew: number | undefined = undefined;
  for (const sample of samples) {
    maxTimerLagMs = Math.max(maxTimerLagMs, sample.timerLagMs);
    if (previousSkew !== undefined) {
      maxClockSkewJumpMs = Math.max(
        maxClockSkewJumpMs,
        Math.abs(sample.clockSkewMs - previousSkew),
      );
    }
    previousSkew = sample.clockSkewMs;
  }
  return {
    running: true,
    intervalMs: state.intervalMs,
    samples,
    maxTimerLagMs,
    maxClockSkewJumpMs,
  };
}
