import { describe, expect, it } from "vitest";

import { parseInitialBoard } from "./boardParser";

describe("parseInitialBoard", () => {
  it("parses an empty board", () => {
    const lines = Array(15).fill("-".repeat(15));
    const board = parseInitialBoard(lines);

    expect(board).toHaveLength(15);
    expect(board[0]).toHaveLength(15);
    expect(board.every((row) => row.every((cell) => cell === null))).toBe(true);
  });

  it("parses black stones (x)", () => {
    const lines = Array(15).fill("-".repeat(15));
    lines[7] = "-------x-------";

    const board = parseInitialBoard(lines);

    expect(board[7][7]).toBe("black");
    expect(board[7][6]).toBeNull();
    expect(board[7][8]).toBeNull();
  });

  it("parses white stones (o)", () => {
    const lines = Array(15).fill("-".repeat(15));
    lines[7] = "-------o-------";

    const board = parseInitialBoard(lines);

    expect(board[7][7]).toBe("white");
  });

  it("parses mixed stones", () => {
    const lines = Array(15).fill("-".repeat(15));
    lines[7] = "------xox------";

    const board = parseInitialBoard(lines);

    expect(board[7][6]).toBe("black");
    expect(board[7][7]).toBe("white");
    expect(board[7][8]).toBe("black");
  });

  it("parses a complex board pattern", () => {
    const lines = [
      "---------------",
      "---------------",
      "---------------",
      "---------------",
      "---------------",
      "---------------",
      "-----xoxox-----",
      "------xox------",
      "-----xoxox-----",
      "---------------",
      "---------------",
      "---------------",
      "---------------",
      "---------------",
      "---------------",
    ];

    const board = parseInitialBoard(lines);

    // Row 6: x o x o x at columns 5-9
    expect(board[6][5]).toBe("black");
    expect(board[6][6]).toBe("white");
    expect(board[6][7]).toBe("black");
    expect(board[6][8]).toBe("white");
    expect(board[6][9]).toBe("black");

    // Row 7: x o x at columns 6-8
    expect(board[7][6]).toBe("black");
    expect(board[7][7]).toBe("white");
    expect(board[7][8]).toBe("black");
  });

  describe("error handling", () => {
    it("throws error for wrong number of rows", () => {
      const lines = Array(14).fill("-".repeat(15));

      expect(() => parseInitialBoard(lines)).toThrow(
        "盤面は15行である必要があります",
      );
    });

    it("throws error for wrong line length", () => {
      const lines = Array(15).fill("-".repeat(15));
      lines[5] = "-".repeat(14);

      expect(() => parseInitialBoard(lines)).toThrow(
        "行5は15文字である必要があります",
      );
    });

    it("throws error for invalid character", () => {
      const lines = Array(15).fill("-".repeat(15));
      lines[7] = "-------?-------";

      expect(() => parseInitialBoard(lines)).toThrow(
        "無効な文字が含まれています。行7列7: ?",
      );
    });
  });
});
