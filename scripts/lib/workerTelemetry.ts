/**
 * bridge worker ごとの計測情報（#128 ハング診断強化）。
 *
 * ハングした worker は wasm 探索でスレッドがブロックされており、`postMessage` を
 * 送っても応答できない（worker の event loop が回らない）。したがって
 * **ハング時に取れる情報はメインスレッド側が保持しているものだけ**である。
 * このモジュールは「メインスレッドが観測できる worker の状態」を worker 単位で
 * 蓄積し、ハングダンプにそのままスナップショットとして載せられる形にする。
 *
 * 蓄積するもの:
 * - worker 起動時の解決済みエンジンパラメータ（bridge worker の ready 通知に同梱）
 * - 起動からの着手要求数
 * - 応答が返ってこない「実行中の要求」（＝ハングした要求そのもの）
 * - 直近 N 手の思考統計（depth/score/thinkingTime/nodes …）
 *
 * worker インスタンス（オブジェクト同一性）をキーにした WeakMap レジストリで
 * 管理するため、worker 再生成時は自動的に新しい空の計測が使われる。
 */

/** 直近手として保持する件数（ダンプサイズと診断価値のバランス） */
export const RECENT_MOVE_HISTORY_LIMIT = 8;

/** bridge worker が ready 時に自己申告する解決済みパラメータ */
export interface EngineParamsSnapshot {
  worktreePath: string;
  difficulty: string;
  /** iterative deepening の上限深さ（DifficultyParams.depth） */
  depth: number;
  timeLimit: number;
  maxNodes: number;
  randomFactor: number;
  randomCriticalScoreThreshold?: number;
  evaluationOptions?: unknown;
  /** 実際に使われた探索エンジン */
  engine: "wasm" | "ts";
  bookEnabled: boolean;
  /** wasm が getStatsBuffer を export しているか（統計欠落の切り分け用） */
  hasStatsBuffer: boolean;
  /** 脅威プローブの状態（ON(default) / OFF(runtime) など） */
  threatProbe: string;
}

/** 送信済みで応答待ちの着手要求 */
export interface PendingRequestRecord {
  requestId: number;
  /** ベンチのタスク index（0-based）。runMatch 経由でのみ入る */
  gameIdx?: number;
  /** 何手目の要求か（1-based, opening 込み） */
  moveNumber: number;
  color: "black" | "white";
  /** 非オープニング要求の通し番号（1-based）。moveSeed 導出に使う */
  nonOpeningOrdinal?: number;
  moveSeed?: number;
  /** 要求送信時刻（ISO8601） */
  sentAt: string;
}

/** 応答が返った手の思考統計 */
export interface MoveStatRecord {
  requestId: number;
  gameIdx?: number;
  moveNumber: number;
  color: "black" | "white";
  depth: number;
  score: number;
  /** worker 内で計測した思考時間 */
  thinkingTimeMs: number;
  /** メインスレッドで計測した往復時間（postMessage → 応答） */
  roundTripMs: number;
  /** wasm 探索統計（nodes/qSearchNodes/ttHits…）。古い wasm では undefined */
  stats?: Record<string, number>;
}

/** ダンプに載せる worker 計測のスナップショット */
export interface WorkerTelemetrySnapshot {
  /** worker 起動からの着手要求数（ハングした要求を含む） */
  requestCount: number;
  engineParams?: EngineParamsSnapshot;
  /** 応答待ちの要求。ハング時はこれがハングした要求そのもの */
  pendingRequest?: PendingRequestRecord;
  /** 直近 N 手の思考統計（古→新） */
  recentMoves: MoveStatRecord[];
}

/**
 * 1 worker 分の計測。メインスレッド側でのみ更新される。
 */
export class WorkerTelemetry {
  private readonly historyLimit: number;
  private requestCount = 0;
  private engineParams: EngineParamsSnapshot | undefined = undefined;
  private pendingRequest: PendingRequestRecord | undefined = undefined;
  private readonly recentMoves: MoveStatRecord[] = [];

  constructor(historyLimit: number = RECENT_MOVE_HISTORY_LIMIT) {
    this.historyLimit = Math.max(1, historyLimit);
  }

  setEngineParams(params: EngineParamsSnapshot): void {
    this.engineParams = params;
  }

  recordRequest(record: PendingRequestRecord): void {
    this.requestCount += 1;
    this.pendingRequest = record;
  }

  /** 応答受信。pending をクリアし、直近手リング（historyLimit 件）へ積む。 */
  recordResponse(record: MoveStatRecord): void {
    if (this.pendingRequest?.requestId === record.requestId) {
      this.pendingRequest = undefined;
    }
    this.recentMoves.push(record);
    while (this.recentMoves.length > this.historyLimit) {
      this.recentMoves.shift();
    }
  }

  /**
   * 現在の計測をコピーして返す。応答なしで終わった要求は pendingRequest に
   * 残るため、ハング時はこれがハングした要求の内容そのものになる。
   */
  snapshot(): WorkerTelemetrySnapshot {
    return {
      requestCount: this.requestCount,
      engineParams: this.engineParams,
      pendingRequest: this.pendingRequest,
      recentMoves: [...this.recentMoves],
    };
  }
}

// ============================================================================
// worker インスタンス単位のレジストリ
// ============================================================================

const registry = new WeakMap<object, WorkerTelemetry>();

/**
 * worker（またはテスト用の任意オブジェクト）に紐づく計測を返す。無ければ作る。
 * worker を terminate → 再生成すると別オブジェクトになるため、計測も自動的に
 * リセットされる（ハング後の respawn で古い統計が混ざらない）。
 */
export function getWorkerTelemetry(worker: object): WorkerTelemetry {
  const existing = registry.get(worker);
  if (existing) {
    return existing;
  }
  const created = new WorkerTelemetry();
  registry.set(worker, created);
  return created;
}

/** ready 通知のペイロードから EngineParamsSnapshot を安全に取り出す（型ガード）。 */
export function extractEngineParams(
  payload: unknown,
): EngineParamsSnapshot | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const { params } = payload as { params?: unknown };
  if (typeof params !== "object" || params === null) {
    return undefined;
  }
  const p = params as Partial<EngineParamsSnapshot>;
  if (typeof p.difficulty !== "string" || typeof p.depth !== "number") {
    return undefined;
  }
  return params as EngineParamsSnapshot;
}
