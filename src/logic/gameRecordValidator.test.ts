/**
 * 棋譜バリデーション テスト
 */

import { describe, expect, it } from "vitest";

import { validateGameRecord } from "./gameRecordValidator";

describe("validateGameRecord", () => {
  describe("正常系", () => {
    it("有効な棋譜を受け付ける", () => {
      const result = validateGameRecord("H8 G7 I9 I8");
      expect(result).toEqual({
        valid: true,
        moveCount: 4,
        normalizedRecord: "H8 G7 I9 I8",
      });
    });

    it("小文字を大文字に正規化する", () => {
      const result = validateGameRecord("h8 g7 i9");
      expect(result).toEqual({
        valid: true,
        moveCount: 3,
        normalizedRecord: "H8 G7 I9",
      });
    });

    it("先頭・末尾の空白をトリムする", () => {
      const result = validateGameRecord("  H8 G7  ");
      expect(result).toEqual({
        valid: true,
        moveCount: 2,
        normalizedRecord: "H8 G7",
      });
    });

    it("複数スペース区切りを正規化する", () => {
      const result = validateGameRecord("H8  G7   I9");
      expect(result).toEqual({
        valid: true,
        moveCount: 3,
        normalizedRecord: "H8 G7 I9",
      });
    });

    it("境界値: A1（左下隅）を受け付ける", () => {
      const result = validateGameRecord("A1");
      expect(result).toEqual({
        valid: true,
        moveCount: 1,
        normalizedRecord: "A1",
      });
    });

    it("境界値: O15（右上隅）を受け付ける", () => {
      const result = validateGameRecord("O15");
      expect(result).toEqual({
        valid: true,
        moveCount: 1,
        normalizedRecord: "O15",
      });
    });

    it("1手の棋譜を受け付ける", () => {
      const result = validateGameRecord("H8");
      expect(result).toEqual({
        valid: true,
        moveCount: 1,
        normalizedRecord: "H8",
      });
    });

    it("15手の棋譜を受け付ける", () => {
      const record = "H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9 J11 J8 J9 K8";
      const result = validateGameRecord(record);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.moveCount).toBe(15);
      }
    });
  });

  describe("異常系", () => {
    it("空文字列はエラー", () => {
      const result = validateGameRecord("");
      expect(result).toEqual({
        valid: false,
        error: "棋譜が入力されていません",
      });
    });

    it("空白のみはエラー", () => {
      const result = validateGameRecord("   ");
      expect(result).toEqual({
        valid: false,
        error: "棋譜が入力されていません",
      });
    });

    it("範囲外の列（P）はエラー", () => {
      const result = validateGameRecord("H8 P5");
      expect(result).toEqual({
        valid: false,
        error: "2手目「P5」が不正です（形式: A1〜O15）",
      });
    });

    it("範囲外の行（0）はエラー", () => {
      const result = validateGameRecord("H0");
      expect(result).toEqual({
        valid: false,
        error: "1手目「H0」が不正です（形式: A1〜O15）",
      });
    });

    it("範囲外の行（16）はエラー", () => {
      const result = validateGameRecord("H16");
      expect(result).toEqual({
        valid: false,
        error: "1手目「H16」が不正です（形式: A1〜O15）",
      });
    });

    it("不正な形式（数字のみ）はエラー", () => {
      const result = validateGameRecord("88");
      expect(result).toEqual({
        valid: false,
        error: "1手目「88」が不正です（形式: A1〜O15）",
      });
    });

    it("不正な形式（文字のみ）はエラー", () => {
      const result = validateGameRecord("HH");
      expect(result).toEqual({
        valid: false,
        error: "1手目「HH」が不正です（形式: A1〜O15）",
      });
    });

    it("重複した手はエラー", () => {
      const result = validateGameRecord("H8 G7 H8");
      expect(result).toEqual({
        valid: false,
        error: "3手目「H8」が重複しています",
      });
    });

    it("大文字小文字が異なる重複もエラー", () => {
      const result = validateGameRecord("H8 h8");
      expect(result).toEqual({
        valid: false,
        error: "2手目「H8」が重複しています",
      });
    });
  });
});
