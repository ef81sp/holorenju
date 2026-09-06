import { describe, expect, it, vi } from "vitest";

import {
  checkDeterministicSupport,
  readSearchFeatures,
} from "./deterministicSupport.ts";

describe("readSearchFeatures", () => {
  it("export があればビット値を返す", () => {
    expect(readSearchFeatures({ getSearchFeatures: () => 3 })).toBe(3);
  });
  it("export が無い旧 wasm は undefined", () => {
    expect(readSearchFeatures({})).toBeUndefined();
  });
  it("wasm 無し（TS フォールバック）は undefined", () => {
    expect(readSearchFeatures(null)).toBeUndefined();
  });
});

describe("checkDeterministicSupport", () => {
  const full = {
    setDeterministicMode: vi.fn(),
    getSearchFeatures: (): number => 0b01,
  };

  it("deterministic 未要求なら常に ok（旧 wasm / TS でも）", () => {
    expect(checkDeterministicSupport(null, false)).toEqual({ ok: true });
    expect(checkDeterministicSupport({}, false)).toEqual({ ok: true });
  });

  it("export と bit0 が揃っていれば ok", () => {
    expect(checkDeterministicSupport(full, true)).toEqual({ ok: true });
  });

  it("setDeterministicMode 無し → 中止理由を返す", () => {
    const r = checkDeterministicSupport(
      { getSearchFeatures: () => 0b01 },
      true,
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/setDeterministicMode/);
  });

  it("getSearchFeatures 無し → 中止", () => {
    const r = checkDeterministicSupport(
      { setDeterministicMode: vi.fn() },
      true,
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/getSearchFeatures/);
  });

  it("bit0 が立っていない → 中止", () => {
    const r = checkDeterministicSupport(
      { ...full, getSearchFeatures: () => 0b10 },
      true,
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/bit0/);
  });

  it("wasm 無し（TS フォールバック）→ 中止", () => {
    const r = checkDeterministicSupport(null, true);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/TS/);
  });
});
