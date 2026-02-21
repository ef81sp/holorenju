/**
 * SGF棋譜の手抽出テスト
 */

import { describe, expect, it } from "vitest";

import { formatMove } from "./gameRecordParser";
import { convertSgfToRecord, isSgfFormat, parseSgfCoord } from "./sgfParser";

describe("isSgfFormat", () => {
  it("SGF文字列を検出する", () => {
    expect(isSgfFormat("(;GM[4]SZ[15]")).toBe(true);
  });

  it("先頭に空白があっても検出する", () => {
    expect(isSgfFormat("  (;GM[4]SZ[15]")).toBe(true);
  });

  it("改行から始まるSGFを検出する", () => {
    expect(isSgfFormat("\n(;GM[4]SZ[15]")).toBe(true);
  });

  it("通常の棋譜はSGFではない", () => {
    expect(isSgfFormat("H8 G7 I9")).toBe(false);
  });

  it("空文字列はSGFではない", () => {
    expect(isSgfFormat("")).toBe(false);
  });
});

describe("parseSgfCoord", () => {
  it.each([
    { coord: "hh", expected: { row: 7, col: 7 }, label: "中央" },
    { coord: "aa", expected: { row: 0, col: 0 }, label: "左上隅" },
    { coord: "oo", expected: { row: 14, col: 14 }, label: "右下隅" },
    { coord: "ao", expected: { row: 14, col: 0 }, label: "左下隅" },
    { coord: "oa", expected: { row: 0, col: 14 }, label: "右上隅" },
  ])(
    "$coordを$label($expected.row,$expected.col)に変換する",
    ({ coord, expected }) => {
      expect(parseSgfCoord(coord)).toEqual(expected);
    },
  );
});

describe("SGF座標と棋譜表記の整合性", () => {
  it.each([
    { coord: "hh", move: "H8" },
    { coord: "aa", move: "A15" },
    { coord: "oo", move: "O1" },
    { coord: "ao", move: "A1" },
    { coord: "oa", move: "O15" },
  ])("SGFの$coord→$moveに変換される", ({ coord, move }) => {
    expect(formatMove(parseSgfCoord(coord))).toBe(move);
  });
});

describe("convertSgfToRecord", () => {
  it("五目クエストの完全なSGFから棋譜を抽出する", () => {
    const sgf = `(;GM[4]SZ[15]RE[W+]
PB[kamikuzu (1419)]
PW[:OyajiBot (1463)]
;B[hh];W[ii];B[ig];W[jg];B[gi];W[jf];B[jh];W[if];B[gh];W[ih];B[ge];W[hf];B[gf];W[gg];B[hi];W[he];B[kh];W[hd];B[hc];W[ie];B[kg];W[fh];B[fj];W[jd])`;
    const result = convertSgfToRecord(sgf);
    expect(result).toBe(
      "H8 I7 I9 J9 G7 J10 J8 I10 G8 I8 G11 H10 G10 G9 H7 H11 K8 H12 H13 I11 K9 F8 F6 J12",
    );
  });

  it("最小のSGFから棋譜を抽出する", () => {
    expect(convertSgfToRecord("(;B[hh];W[ii];B[ig])")).toBe("H8 I7 I9");
  });

  it("手がないSGFではnullを返す", () => {
    expect(convertSgfToRecord("(;GM[4]SZ[15])")).toBeNull();
  });

  it("SGFでない文字列ではnullを返す", () => {
    expect(convertSgfToRecord("H8 G7 I9")).toBeNull();
  });

  it("重複する手はスキップする", () => {
    expect(convertSgfToRecord("(;B[hh];W[hh];B[ii])")).toBe("H8 I7");
  });
});
