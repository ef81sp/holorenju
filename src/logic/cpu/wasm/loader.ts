import type { WasmModuleContext } from "./types";

async function loadWasmBuffer(wasmUrl: URL): Promise<ArrayBuffer> {
  // Node.js: use fs.readFileSync + fileURLToPath
  // Browser: use fetch
  if ("process" in globalThis) {
    // Dynamic import with string concatenation to prevent bundler resolution
    const nodePrefix = "node:";
    const fs = (await import(/* @vite-ignore */ `${nodePrefix}fs`)) as {
      readFileSync: (path: string) => { buffer: ArrayBuffer };
    };
    const url = (await import(/* @vite-ignore */ `${nodePrefix}url`)) as {
      fileURLToPath: (url: URL) => string;
    };
    return fs.readFileSync(url.fileURLToPath(wasmUrl)).buffer;
  }
  const response = await fetch(wasmUrl);
  return response.arrayBuffer();
}

export async function loadWasmModule(): Promise<WasmModuleContext> {
  const wasmUrl = new URL(
    "../../../../zig/zig-out/bin/cpu-engine.wasm",
    import.meta.url,
  );
  const buffer = await loadWasmBuffer(wasmUrl);

  const imports = {
    env: {
      getTimestampMsExternal: () => Math.round(performance.now()),
    },
  };
  const { instance } = await WebAssembly.instantiate(buffer, imports);
  return instance.exports as unknown as WasmModuleContext;
}
