/**
 * 棋譜パーサーのテスト
 */

import { describe, expect, it } from "vitest";

import {
  createBoardFromRecord,
  formatMove,
  parseGameRecord,
  parseMove,
} from "./gameRecordParser";

describe("parseMove", () => {
  it("H8を正しくパースする", () => {
    const pos = parseMove("H8");
    expect(pos).toEqual({ row: 7, col: 7 });
  });

  it("A1を正しくパースする（左下隅）", () => {
    const pos = parseMove("A1");
    expect(pos).toEqual({ row: 14, col: 0 });
  });

  it("O15を正しくパースする（右上隅）", () => {
    const pos = parseMove("O15");
    expect(pos).toEqual({ row: 0, col: 14 });
  });

  it("A15を正しくパースする（左上隅）", () => {
    const pos = parseMove("A15");
    expect(pos).toEqual({ row: 0, col: 0 });
  });

  it("O1を正しくパースする（右下隅）", () => {
    const pos = parseMove("O1");
    expect(pos).toEqual({ row: 14, col: 14 });
  });
});

describe("formatMove", () => {
  it("中央座標をH8に変換する", () => {
    expect(formatMove({ row: 7, col: 7 })).toBe("H8");
  });

  it("左下隅をA1に変換する", () => {
    expect(formatMove({ row: 14, col: 0 })).toBe("A1");
  });

  it("右上隅をO15に変換する", () => {
    expect(formatMove({ row: 0, col: 14 })).toBe("O15");
  });
});

describe("parseGameRecord", () => {
  it("棋譜文字列を手の配列に変換する", () => {
    const moves = parseGameRecord("H8 G7 I7");
    expect(moves).toHaveLength(3);
    expect(moves[0]).toEqual({
      position: { row: 7, col: 7 },
      color: "black",
    });
    expect(moves[1]).toEqual({
      position: { row: 8, col: 6 },
      color: "white",
    });
    expect(moves[2]).toEqual({
      position: { row: 8, col: 8 },
      color: "black",
    });
  });
});

describe("createBoardFromRecord", () => {
  it("棋譜から盤面を作成する", () => {
    const { board, nextColor } = createBoardFromRecord("H8 G7 I7");
    expect(board[7]?.[7]).toBe("black"); // H8
    expect(board[8]?.[6]).toBe("white"); // G7
    expect(board[8]?.[8]).toBe("black"); // I7
    expect(nextColor).toBe("white"); // 3手後は白番
  });

  it("指定手数まで再現する", () => {
    const { board, nextColor } = createBoardFromRecord("H8 G7 I7", 2);
    expect(board[7]?.[7]).toBe("black"); // H8
    expect(board[8]?.[6]).toBe("white"); // G7
    expect(board[8]?.[8]).toBe(null); // I7は未再現
    expect(nextColor).toBe("black"); // 2手後は黒番
  });
});
