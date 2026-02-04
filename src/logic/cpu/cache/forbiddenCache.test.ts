import { describe, expect, it, beforeEach } from "vitest";

import {
  clearForbiddenCache,
  getForbiddenResult,
  setForbiddenResult,
  getForbiddenCacheSize,
} from "./forbiddenCache";

describe("forbiddenCache", () => {
  beforeEach(() => {
    clearForbiddenCache();
  });

  describe("基本操作", () => {
    it("キャッシュが空の場合はundefinedを返す", () => {
      const result = getForbiddenResult(123n, 7, 7);
      expect(result).toBeUndefined();
    });

    it("保存した結果を取得できる", () => {
      const hash = 12345n;
      const forbiddenResult = { isForbidden: true, type: "double-three" as const, positions: [{ row: 7, col: 7 }] };

      setForbiddenResult(hash, 7, 7, forbiddenResult);
      const retrieved = getForbiddenResult(hash, 7, 7);

      expect(retrieved).toEqual(forbiddenResult);
    });

    it("異なる位置は異なるエントリとして保存される", () => {
      const hash = 12345n;
      const result1 = { isForbidden: true, type: "double-three" as const, positions: [{ row: 7, col: 7 }] };
      const result2 = { isForbidden: false, type: null };

      setForbiddenResult(hash, 7, 7, result1);
      setForbiddenResult(hash, 7, 8, result2);

      expect(getForbiddenResult(hash, 7, 7)).toEqual(result1);
      expect(getForbiddenResult(hash, 7, 8)).toEqual(result2);
    });

    it("同じ位置でもハッシュが異なる場合はキャッシュミス", () => {
      const hash1 = 12345n;
      const hash2 = 54321n;
      const result = { isForbidden: true, type: "double-four" as const, positions: [{ row: 7, col: 7 }] };

      setForbiddenResult(hash1, 7, 7, result);

      // 異なるハッシュでアクセス
      expect(getForbiddenResult(hash2, 7, 7)).toBeUndefined();
      // 正しいハッシュでアクセス
      expect(getForbiddenResult(hash1, 7, 7)).toEqual(result);
    });
  });

  describe("clearForbiddenCache", () => {
    it("キャッシュをクリアする", () => {
      const hash = 12345n;
      const result = { isForbidden: false, type: null };

      setForbiddenResult(hash, 7, 7, result);
      expect(getForbiddenCacheSize()).toBe(1);

      clearForbiddenCache();

      expect(getForbiddenCacheSize()).toBe(0);
      expect(getForbiddenResult(hash, 7, 7)).toBeUndefined();
    });
  });

  describe("キャッシュサイズ", () => {
    it("エントリ数を正しく返す", () => {
      const hash = 12345n;
      const result = { isForbidden: false, type: null };

      expect(getForbiddenCacheSize()).toBe(0);

      setForbiddenResult(hash, 0, 0, result);
      expect(getForbiddenCacheSize()).toBe(1);

      setForbiddenResult(hash, 0, 1, result);
      expect(getForbiddenCacheSize()).toBe(2);

      setForbiddenResult(hash, 1, 0, result);
      expect(getForbiddenCacheSize()).toBe(3);
    });
  });
});
