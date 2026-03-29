import { describe, expect, it } from "vitest";

import { loadWasmModule } from "./loader";

describe("WASM loader", () => {
  it("add(1, 2) = 3", async () => {
    const wasm = await loadWasmModule();
    expect(wasm.add(1, 2)).toBe(3);
  });
});
