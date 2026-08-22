import { loadWasmBuffer } from "./loader";

/**
 * 禁手専用 thin wasm（~41KB）のエクスポート（#37 P1）。
 * メインスレッドが 48MB エンジン wasm を載せずに禁手判定（Zig 単一ソース）を使うための最小面。
 */
export interface ForbiddenWasmContext {
  boardInit: () => void;
  boardSet: (row: number, col: number, value: number) => void;
  /** 0=none / 1=overline / 2=double_four / 3=double_three（黒のみ意味を持つ） */
  checkForbiddenPointWasm: (row: number, col: number) => number;
  /**
   * (row,col) に color が配置済みの盤面で五が成立するか（1=五 / 0=五でない）。
   * 黒はちょうど 5、白は 5 以上（白に長連禁手はない・#125）。
   */
  checkFiveWasm: (row: number, col: number, color: number) => number;
}

export async function loadForbiddenWasm(): Promise<ForbiddenWasmContext> {
  const wasmUrl = new URL(
    "../../../../zig/zig-out/bin/forbidden.wasm",
    import.meta.url,
  );
  const buffer = await loadWasmBuffer(wasmUrl);
  // forbidden.wasm は extern import を持たない（freestanding）
  const { instance } = await WebAssembly.instantiate(buffer, {});
  return instance.exports as unknown as ForbiddenWasmContext;
}
