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
  wasmGetPatternScore: (count: number, end1: number, end2: number) => number;
  wasmGetPatternType: (count: number, end1: number, end2: number) => number;

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
  findBestMove: (
    color: number,
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    absoluteTimeLimitMs: number,
    aspirationMode: number,
    evalOptionsFlags: number,
  ) => void;
  getResultBuffer: () => number;
  ttClear: () => void;

  // 探索統計バッファ（12フィールド×u32=48バイト。レイアウトは main.zig writeStats 参照）
  getStatsBuffer: () => number;

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
