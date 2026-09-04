/**
 * bridge worker ごとの計測情報（#128 ハング診断強化）。
 *
 * ハングした worker はメッセージに応答できない（wasm 探索でスレッドが同期ブロック
 * されており event loop が回らない）。したがって**ハング時に読み出せるのは
 * メインスレッド側が保持している情報**と、共有メモリ経由の生存信号
 * （`workerLiveness.ts`）だけである。このモジュールは前者を worker 単位に集約する。
 *
 * 蓄積するもの:
 * - worker 起動時の解決済みエンジンパラメータ（bridge worker の ready 通知に同梱）
 * - 起動からの着手要求数
 * - 応答が返ってこない「実行中の要求」（＝ハングした要求そのもの）
 * - 直近 N 手の思考統計（depth/score/interrupted/thinkingTime/nodes …）
 * - この worker が同一インスタンスのまま打ち終えた直近 M 局の棋譜
 *
 * worker インスタンス（オブジェクト同一性）をキーにした WeakMap レジストリで
 * 管理するため、worker 再生成時は自動的に新しい空の計測が使われる。
 */
import type { ReplayMove } from "./hangReplay.ts";
import type { LivenessChannel } from "./workerLiveness.ts";

/** 直近手として保持する件数（ダンプサイズと診断価値のバランス） */
export const RECENT_MOVE_HISTORY_LIMIT = 32;

/** 直近局として保持する件数（履歴再生の前段に使う） */
export const RECENT_GAMES_HISTORY_LIMIT = 10;

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
  /**
   * 注入された eval 重み（weight-bench / Texel）の指紋。
   * 重みそのものはダンプを肥大化させるので、キー数とハッシュだけを持つ。
   * replay 側で「同じ重みで再現しているか」を突き合わせるのに使う。
   */
  evalWeightsFingerprint?: { count: number; hash: string };
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
  /**
   * この要求で実際に worker へ渡した moveSeed。
   * **replay 時はこの値が権威**（再導出はずれるとサイレントに別 seed になる）。
   */
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
  /**
   * 探索が時間/ノード上限で打ち切られたか。
   * 「長考した手が走り切ったのか打ち切られたのか」を区別する唯一のフラグで、
   * 時間制限が効いていない疑い（#128 の g3）の判定に必須。
   */
  interrupted: boolean;
  /** worker 内で計測した思考時間 */
  thinkingTimeMs: number;
  /** メインスレッドで計測した往復時間（postMessage → 応答） */
  roundTripMs: number;
  /** wasm 探索統計（nodes/qSearchNodes/ttHits…）。古い wasm では undefined */
  stats?: Record<string, number>;
}

/** この worker が打ち終えた 1 局（履歴再生の入力） */
export interface RecentGameRecord {
  gameIdx: number;
  jushuName: string;
  isABlack: boolean;
  /** この局の PRNG seed（未指定 bench なら undefined） */
  gameSeed?: number;
  /** 開局手（isOpening）を含む全着手（打たれた順、座標のみ） */
  moves: ReplayMove[];
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
  /** この worker が同一インスタンスのまま打ち終えた直近 M 局（古→新） */
  recentGames: RecentGameRecord[];
}

/** 上限つきで push する（古いものから捨てる）。 */
function pushCapped<T>(list: T[], item: T, limit: number): void {
  list.push(item);
  if (list.length > limit) {
    list.splice(0, list.length - limit);
  }
}

/**
 * 1 worker 分の計測。メインスレッド側でのみ更新される。
 *
 * @param historyLimit テスト専用の上書き。本番は既定値（RECENT_MOVE_HISTORY_LIMIT）を使う。
 * @param gamesLimit テスト専用の上書き。本番は既定値（RECENT_GAMES_HISTORY_LIMIT）を使う。
 */
export class WorkerTelemetry {
  private readonly historyLimit: number;
  private readonly gamesLimit: number;
  private requestCount = 0;
  private engineParams: EngineParamsSnapshot | undefined = undefined;
  private pendingRequest: PendingRequestRecord | undefined = undefined;
  private readonly recentMoves: MoveStatRecord[] = [];
  private readonly recentGames: RecentGameRecord[] = [];
  private livenessChannel: LivenessChannel | undefined = undefined;

  constructor(
    historyLimit: number = RECENT_MOVE_HISTORY_LIMIT,
    gamesLimit: number = RECENT_GAMES_HISTORY_LIMIT,
  ) {
    this.historyLimit = Math.max(1, historyLimit);
    this.gamesLimit = Math.max(1, gamesLimit);
  }

  setEngineParams(params: EngineParamsSnapshot): void {
    this.engineParams = params;
  }

  /** 生存信号（SharedArrayBuffer）の共有チャネルを覚える。 */
  setLivenessChannel(channel: LivenessChannel): void {
    this.livenessChannel = channel;
  }

  getLivenessChannel(): LivenessChannel | undefined {
    return this.livenessChannel;
  }

  recordRequest(record: PendingRequestRecord): void {
    this.requestCount += 1;
    this.pendingRequest = record;
  }

  /** 応答受信。pending をクリアし、直近手リング（historyLimit 件）へ積む。 */
  recordResponse(record: MoveStatRecord): void {
    this.clearPending(record.requestId);
    pushCapped(this.recentMoves, record, this.historyLimit);
  }

  /**
   * 応答は返ったが着手ではなかった場合（worker のエラー応答）に pending を消す。
   * 消し忘れるとダンプの pendingRequest が「ハングした要求」ではなくなる。
   */
  clearPending(requestId?: number): void {
    if (
      requestId === undefined ||
      this.pendingRequest?.requestId === requestId
    ) {
      this.pendingRequest = undefined;
    }
  }

  /** この worker が 1 局打ち終えたことを記録する。 */
  recordGame(game: RecentGameRecord): void {
    pushCapped(this.recentGames, game, this.gamesLimit);
  }

  /** worker ペアが再生成された等で履歴が無効になったときに捨てる。 */
  clearGames(): void {
    this.recentGames.length = 0;
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
      recentGames: [...this.recentGames],
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
