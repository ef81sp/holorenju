import { describe, expect, it } from "vitest";

import { parseHangInjectEnv } from "./parseHangInjectEnv.ts";

describe("parseHangInjectEnv", () => {
  it("undefined なら null（無効化＝正常）", () => {
    expect(parseHangInjectEnv(undefined)).toEqual({ kind: "ok", value: null });
  });

  it("空文字列も null", () => {
    expect(parseHangInjectEnv("")).toEqual({ kind: "ok", value: null });
  });

  it("gameIdx:requestOrdinal 2要素形式（side 省略）", () => {
    expect(parseHangInjectEnv("3:5")).toEqual({
      kind: "ok",
      value: { gameIdx: 3, requestOrdinal: 5, side: undefined },
    });
  });

  it("3要素形式で side=A", () => {
    expect(parseHangInjectEnv("0:1:A")).toEqual({
      kind: "ok",
      value: { gameIdx: 0, requestOrdinal: 1, side: "A" },
    });
  });

  it("3要素形式で side=B", () => {
    expect(parseHangInjectEnv("7:12:B")).toEqual({
      kind: "ok",
      value: { gameIdx: 7, requestOrdinal: 12, side: "B" },
    });
  });

  it("要素数が違えばエラー", () => {
    const r = parseHangInjectEnv("1");
    expect(r.kind).toBe("error");
  });

  it("gameIdx が数値でなければエラー", () => {
    const r = parseHangInjectEnv("abc:1");
    expect(r.kind).toBe("error");
  });

  it("gameIdx が負ならエラー", () => {
    const r = parseHangInjectEnv("-1:1");
    expect(r.kind).toBe("error");
  });

  it("requestOrdinal が 0 ならエラー（1-based）", () => {
    const r = parseHangInjectEnv("0:0");
    expect(r.kind).toBe("error");
  });

  it("requestOrdinal が数値でなければエラー", () => {
    const r = parseHangInjectEnv("0:x");
    expect(r.kind).toBe("error");
  });

  it("side が A/B 以外ならエラー", () => {
    const r = parseHangInjectEnv("0:1:C");
    expect(r.kind).toBe("error");
  });
});
