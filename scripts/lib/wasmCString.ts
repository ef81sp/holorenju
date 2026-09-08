/**
 * wasm メモリ上の null 終端文字列（Zig の `[*:0]const u8`）を読む。
 * `getEvalParamName` 等が返すポインタのデコードに使う（prospect-texel /
 * prospect-anchor / evalParams.wasm.test の共有ユーティリティ）。
 */
export function readCString(
  wasm: { memory: WebAssembly.Memory },
  ptr: number,
): string {
  const bytes = new Uint8Array(wasm.memory.buffer);
  let end = ptr;
  while (bytes[end] !== 0) {
    end++;
  }
  return new TextDecoder().decode(bytes.subarray(ptr, end));
}
