import { loadWasmBuffer } from "./loader";

/**
 * 脅威分類専用 thin wasm（~28KB）のエクスポート（#37 P3 PR2）。
 * review/メインが 48MB エンジン wasm を載せずに四/活三判定（Zig 単一ソース=vct.classifyThreat）を使う最小面。
 */
export interface ThreatWasmContext {
  boardInit: () => void;
  boardSet: (row: number, col: number, value: number) => void;
  /** cells から bitboard.global_bb を再構築する。classifyThreatWasm の前に必ず呼ぶ。 */
  syncBitboard: () => void;
  /** bit0=createsFour（黒長連除外済）/ bit1=createsOpenThree。(row,col) に color 配置済み前提。 */
  classifyThreatWasm: (row: number, col: number, color: number) => number;
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
