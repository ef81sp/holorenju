import { loadWasmBuffer } from "./loader";

/**
 * 脅威分類専用 thin wasm（~28KB）のエクスポート（#37 P3 PR2）。
 * review/メインが 48MB エンジン wasm を載せずに四/活三判定（Zig 単一ソース=vct.classifyThreat）を使う最小面。
 */
export interface ThreatWasmContext {
  boardInit: () => void;
  boardSet: (row: number, col: number, value: number) => void;
  /** cells から bitboard.global_bb を再構築する。classifyThreatWasm/detectOpponentThreatsWasm の前に必ず呼ぶ。 */
  syncBitboard: () => void;
  /** bit0=createsFour（黒長連除外済）/ bit1=createsOpenThree。(row,col) に color 配置済み前提。 */
  classifyThreatWasm: (row: number, col: number, color: number) => number;
  /** (row,col)（空き前提）に color を打つと四三ができるか。1/0。内部で仮置き・復元。 */
  createsFourThreeWasm: (row: number, col: number, color: number) => number;
  /** opponent_color の脅威を検出し ThreatInfo をバッファにシリアライズする（#37 P3 PR4）。 */
  detectOpponentThreatsWasm: (opponentColor: number) => void;
  /** ThreatInfo シリアライズバッファの先頭オフセット（memory 内）を返す。 */
  getThreatInfoBuffer: () => number;
  /** (row,col) にミセ手配置済みの盤面で四三ターゲットを検出しバッファに書く（#37 P3 PR5b）。 */
  findMiseTargetsWasm: (row: number, col: number, color: number) => void;
  /** ミセターゲットバッファの先頭オフセット（memory 内）を返す。 */
  getMiseBuffer: () => number;
  /** color の両ミセ手を列挙しバッファに書く（#37 P3 PR5b）。 */
  findDoubleMiseMovesWasm: (color: number) => void;
  /** 両ミセ手バッファの先頭オフセット（memory 内）を返す。 */
  getDoubleMiseBuffer: () => number;
  /** color が活三を持つか（1/0）。盤面全走査（#37 P3 PR6）。 */
  hasOpenThreeWasm: (color: number) => number;
  /** color がミセ手（1手で四三）を持つか（1/0）。盤面全走査（#37 P3 PR6）。 */
  hasFourThreeAvailableWasm: (color: number) => number;
  /** color の脅威手（四・活三、四優先）を列挙しバッファに書く（#37 P3 PR6）。 */
  findThreatMovesWasm: (color: number) => void;
  /** 脅威手バッファの先頭オフセット（memory 内）を返す。 */
  getThreatMovesBuffer: () => number;
  /** (row,col,dir,color) で跳び四が成立するか（1/0）。配置済み cells 規約（#37 P4 PR-A）。 */
  checkJumpFourWasm: (
    row: number,
    col: number,
    dir: number,
    color: number,
  ) => number;
  /** (row,col,dir,color) で跳び三が成立するか（1/0）。配置済み cells 規約。 */
  checkJumpThreeWasm: (
    row: number,
    col: number,
    dir: number,
    color: number,
  ) => number;
  /** (row,col,dir,color) で達四が成立するか（1/0）。配置済み cells 規約。 */
  checkStraightFourWasm: (
    row: number,
    col: number,
    dir: number,
    color: number,
  ) => number;
  /** 連続三の達四点（最大2点）を pattern points バッファに書く。 */
  getConsecutiveThreeStraightFourPointsWasm: (
    row: number,
    col: number,
    dir: number,
    color: number,
  ) => void;
  /** 跳び三の達四点（最大1点）を pattern points バッファに書く。 */
  getJumpThreeStraightFourPointsWasm: (
    row: number,
    col: number,
    dir: number,
    color: number,
  ) => void;
  /** pattern points バッファの先頭オフセット（memory 内）を返す。 */
  getPatternPointsBuffer: () => number;
  /**
   * 指定方向の「埋めると五になる点」を five points バッファに書く（issue #115）。
   * TS の `collectLineFivePoints`（core/lineAnalysis.ts）とのパリティ検証用。
   */
  collectLineFivePointsWasm: (
    row: number,
    col: number,
    dir: number,
    color: number,
  ) => void;
  /** five points バッファの先頭オフセット（memory 内）を返す。 */
  getFivePointsBuffer: () => number;
  /**
   * 四に対する受け点（3 値・issue #124）。
   * Zig 側の番兵定数は `quiescence.FOUR_DEFENSE_UNSTOPPABLE` / `FOUR_DEFENSE_NOT_FOUR`。
   * - 止め四: `row * 15 + col`（0..224）
   * - 活四（防御不可・`unstoppable`）: 255
   * - そもそも四ではない（`not_four`）: 254
   *
   * TS の `getFourDefensePosition`（search/threatPatterns.ts）とのパリティ検証用。
   */
  getFourDefensePositionWasm: (
    row: number,
    col: number,
    color: number,
  ) => number;
  /** wasm 線形メモリ（バッファ読み取り用）。 */
  memory: WebAssembly.Memory;
}

export async function loadThreatWasm(): Promise<ThreatWasmContext> {
  const wasmUrl = new URL(
    "../../../../zig/zig-out/bin/threat.wasm",
    import.meta.url,
  );
  const buffer = await loadWasmBuffer(wasmUrl);
  // threat.wasm は extern import を持たない（freestanding）
  const { instance } = await WebAssembly.instantiate(buffer, {});
  return instance.exports as unknown as ThreatWasmContext;
}

// ───────────────────────────────────────────────────────────────
// 共有シングルトン（#37 P4 #43）
// threatAdapter / patternsAdapter が同一 threat.wasm インスタンスを共用するための
// 共有状態。中立な低レベルモジュール（threatLoader）に置くことで
// patternsAdapter → threatAdapter の import 辺を消し、judgment 層 → adapter の
// 張替えで循環依存が生じないようにする。
// ───────────────────────────────────────────────────────────────

let threatWasm: ThreatWasmContext | undefined = undefined;

/** 起動時に1回プリロード（ブートゲートで mount 前に await）。 */
export async function preloadThreatWasm(): Promise<void> {
  if (threatWasm) {
    return;
  }
  threatWasm = await loadThreatWasm();
}

/** テスト用: wasm インスタンスを直接注入/解除する。 */
export function setThreatWasmForTest(w: ThreatWasmContext | undefined): void {
  threatWasm = w;
}

/** ロード済み threat wasm インスタンスを返す（未ロード時 undefined）。 */
export function getThreatWasm(): ThreatWasmContext | undefined {
  return threatWasm;
}
