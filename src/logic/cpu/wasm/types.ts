export interface WasmModuleContext {
  memory: WebAssembly.Memory;
  add: (a: number, b: number) => number;

  // Board operations
  boardInit: () => void;
  boardGet: (row: number, col: number) => number;
  boardSet: (row: number, col: number, value: number) => void;

  // Direction analysis (packed return values)
  countInDirection: (
    row: number,
    col: number,
    dr: number,
    dc: number,
    color: number,
  ) => number;
  analyzeDirection: (
    row: number,
    col: number,
    dr: number,
    dc: number,
    color: number,
  ) => number;

  // Parity oracle (#21): TS⇄Zig 連珠判定の一致検証用。本番探索からは未使用。
  classifyPointWasm: (row: number, col: number, color: number) => number;
  getJumpThreeStraightFourPointsWasm: (
    row: number,
    col: number,
    dirIndex: number,
    color: number,
  ) => number;

  // Pattern scoring
  evaluateDirectionScores: (row: number, col: number, color: number) => number;
  // #132: 黒の長連（6 連以上＝禁手）を五から外すため color を受け取る
  wasmGetPatternScore: (
    count: number,
    end1: number,
    end2: number,
    color: number,
  ) => number;
  wasmGetPatternType: (
    count: number,
    end1: number,
    end2: number,
    color: number,
  ) => number;

  // Board evaluation
  evaluateBoard: (perspective: number, optionsFlags: number) => number;

  // eval 重み実行時注入（id 0-8=legacy, 100〜=prospect。bench/回帰スクリプト用）
  getEvalParam: (id: number) => number;
  // id の正準名（[*:0]const u8 ポインタ。呼び出し側で null 終端文字列として読む。
  // SSoT: scores.zig(legacy id) / prospect.zig(prospect id、getProspectParamName)）
  getEvalParamName: (id: number) => number;

  // 空点プロスペクト特徴ベクトル抽出（P3 の Texel 回帰用特徴ダンプ）
  extractProspectFeatures: (
    perspective: number,
    stmIsPerspective: number,
  ) => number;
  getProspectFeatureBuffer: () => number;

  // Search
  // 末尾 3 引数は振り返り用（review-multipv-2026-09-06.md §2.4）。
  // exactTopK: root 上位 K 手を真値に再探索（0 = 従来どおり）。
  // forcedRow/forcedCol: 強制候補（255 = なし）。省略時は wasm 側で 0 になる。
  // 旧 wasm は無視する。
  findBestMove: (
    color: number,
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    absoluteTimeLimitMs: number,
    aspirationMode: number,
    evalOptionsFlags: number,
    /** root の上位 K 手を真値にする（0/省略 = 従来どおり。振り返り用。設計メモ review-multipv §2.4） */
    exactTopK?: number,
    /** 必ず真値で返す手の row（255 = なし。exactTopK が 0 のときは無視） */
    forcedRow?: number,
    /** 同 col（255 = なし） */
    forcedCol?: number,
  ) => void;
  getResultBuffer: () => number;
  ttClear: () => void;

  // 探索統計バッファ（12フィールド×u32=48バイト。append-only で getSearchFeatures() bit1
  // の wasm では 60 バイト（+48 pre_search_nodes / +52 probe_nodes / +56 absolute_deadline_hit）。レイアウトは main.zig writeStats 参照）
  getStatsBuffer: () => number;

  // 決定的探索モード（bench-fixed-nodes-2026-09-06.md）。旧 wasm には無い＝optional。
  setDeterministicMode?: (enabled: number) => void;
  /** bit0=deterministic 対応、bit1=stats_buffer 拡張。旧 wasm には無い＝optional。 */
  getSearchFeatures?: () => number;
  /** stats_buffer の実長（バイト）。旧 wasm には無い＝optional。 */
  getStatsBufferLength?: () => number;

  // Gate 0 計測用（docs/plans/eval-basis-prospect-2026-07-13.md §5）
  setThreatProbeEnabled: (enabled: number) => void;
  getAspirationResearchCount: () => number;

  // PV extraction
  extractPV: (
    bestRow: number,
    bestCol: number,
    color: number,
    maxLen: number,
  ) => void;
  getResultPVBuffer: () => number;

  // VCF sequence
  findVCFSequenceWasm: (
    color: number,
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
  ) => void;
  findVCFSequenceFromFirstMoveWasm: (
    row: number,
    col: number,
    color: number,
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
  ) => void;
  getVCFSequenceBuffer: () => number;

  // Mise-VCF sequence
  findMiseVCFSequenceWasm: (
    color: number,
    timeLimitMs: number,
    maxNodes: number,
    collectBranches: number,
  ) => void;
  getMiseVCFSequenceBuffer: () => number;

  // VCT sequence
  findVCTSequenceWasm: (
    color: number,
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    collectBranches: number,
  ) => void;
  /** 被詰み判定専用（strict）。攻めの forcedWin 検出には findVCTSequenceWasm（lenient）を使うこと。 */
  findVCTSequenceStrictWasm: (
    color: number,
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    collectBranches: number,
  ) => void;
  findVCTSequenceFromFirstMoveWasm: (
    row: number,
    col: number,
    color: number,
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    collectBranches: number,
  ) => void;
  isVCTFirstMoveWasm: (
    row: number,
    col: number,
    color: number,
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
  ) => number;
  getVCTSequenceBuffer: () => number;
  /** 直近の詰み木でアリーナ上限超過が起きたか（1/0。issue #122） */
  getLastForcedWinTreeOverflow: () => number;
  /** 直近の詰み木で1ノードの受けが切り捨てられたか（1/0。issue #122） */
  getLastForcedWinTreeDefenseTruncated: () => number;
}

/** Cell values matching Zig Cell enum */
export const CELL = {
  EMPTY: 0,
  BLACK: 1,
  WHITE: 2,
} as const;

/** EndState values matching Zig EndState enum */
export const END_STATE = {
  EMPTY: 0,
  OPPONENT: 1,
  EDGE: 2,
} as const;
