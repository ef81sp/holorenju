/**
 * --dump-book メタデータ生成のテスト（opening-book-2026-07-16.md §1）。
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildBookDumpMetadata,
  getGitRev,
  getWasmBuildTime,
} from "./bookDumpMetadata";

const thisFile = fileURLToPath(import.meta.url);

describe("buildBookDumpMetadata", () => {
  it("パラメータをそのままメタデータオブジェクトに反映する", () => {
    const meta = buildBookDumpMetadata({
      gitRev: "abc123",
      wasmBuildTime: "2026-07-16T00:00:00.000Z",
      seed: 42,
      roots: "雲月",
      b5: 12,
      b7: 20,
      hardTimeMs: 1000,
      now: new Date("2026-07-17T00:00:00.000Z"),
    });
    expect(meta).toEqual({
      type: "metadata",
      timestamp: "2026-07-17T00:00:00.000Z",
      gitRev: "abc123",
      wasmBuildTime: "2026-07-16T00:00:00.000Z",
      seed: 42,
      roots: "雲月",
      b5: 12,
      b7: 20,
      hardTimeMs: 1000,
      side: "white",
    });
  });

  it("side を明示指定すると反映される（★第2段: black版）", () => {
    const meta = buildBookDumpMetadata({
      gitRev: "abc123",
      wasmBuildTime: "2026-07-16T00:00:00.000Z",
      seed: 42,
      roots: null,
      b5: 12,
      b7: 20,
      hardTimeMs: null,
      side: "black",
      now: new Date("2026-07-17T00:00:00.000Z"),
    });
    expect(meta.side).toBe("black");
  });

  it("roots/hardTimeMs は null を許容する（フィルタなし・実機default）", () => {
    const meta = buildBookDumpMetadata({
      gitRev: "abc123",
      wasmBuildTime: "2026-07-16T00:00:00.000Z",
      seed: 1,
      roots: null,
      b5: 12,
      b7: 20,
      hardTimeMs: null,
      now: new Date("2026-07-17T00:00:00.000Z"),
    });
    expect(meta.roots).toBeNull();
    expect(meta.hardTimeMs).toBeNull();
  });

  it("now 省略時は現在時刻を timestamp に使う", () => {
    const before = Date.now();
    const meta = buildBookDumpMetadata({
      gitRev: "abc123",
      wasmBuildTime: "2026-07-16T00:00:00.000Z",
      seed: 1,
      roots: null,
      b5: 12,
      b7: 20,
      hardTimeMs: null,
    });
    const after = Date.now();
    const ts = new Date(meta.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe("getGitRev", () => {
  it("40桁の16進文字列（コミットハッシュ）を返す", () => {
    const rev = getGitRev();
    expect(rev).not.toBe("unknown");
    expect(rev).toMatch(/^[0-9a-f]{40}$/);
  });

  it("不正な cwd を渡すと 'unknown' を返す（例外を投げない）", () => {
    const rev = getGitRev("/nonexistent/path/xyz");
    expect(rev).toBe("unknown");
  });
});

describe("getWasmBuildTime", () => {
  it("存在しないパスを渡すと 'unknown' を返す（例外を投げない）", () => {
    const t = getWasmBuildTime("/nonexistent/path/xyz.wasm");
    expect(t).toBe("unknown");
  });

  it("存在するファイルなら ISO8601 文字列を返す", () => {
    // このファイル自身の mtime を使う（wasm である必要はない）
    const t = getWasmBuildTime(thisFile);
    expect(() => new Date(t)).not.toThrow();
    expect(new Date(t).toISOString()).toBe(t);
  });
});
