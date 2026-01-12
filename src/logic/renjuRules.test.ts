import { describe, expect, it } from "vitest";

import {
  checkFive,
  checkForbiddenMove,
  checkWin,
  copyBoard,
  createEmptyBoard,
  isValidPosition,
  recognizePattern,
} from "./renjuRules";

describe("isValidPosition", () => {
  it("returns true for valid positions", () => {
    expect(isValidPosition(0, 0)).toBe(true);
    expect(isValidPosition(7, 7)).toBe(true);
    expect(isValidPosition(14, 14)).toBe(true);
  });

  it("returns false for positions outside the board", () => {
    expect(isValidPosition(-1, 0)).toBe(false);
    expect(isValidPosition(0, -1)).toBe(false);
    expect(isValidPosition(15, 0)).toBe(false);
    expect(isValidPosition(0, 15)).toBe(false);
    expect(isValidPosition(15, 15)).toBe(false);
  });
});

describe("createEmptyBoard", () => {
  it("creates a 15x15 board filled with null", () => {
    const board = createEmptyBoard();
    expect(board).toHaveLength(15);
    expect(board[0]).toHaveLength(15);
    expect(board.every((row) => row.every((cell) => cell === null))).toBe(true);
  });
});

describe("copyBoard", () => {
  it("creates a deep copy of the board", () => {
    const original = createEmptyBoard();
    original[7][7] = "black";

    const copied = copyBoard(original);
    copied[7][7] = "white";

    expect(original[7][7]).toBe("black");
    expect(copied[7][7]).toBe("white");
  });
});

describe("checkFive", () => {
  it("detects horizontal five", () => {
    const board = createEmptyBoard();
    // Place 4 black stones horizontally
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";

    // Placing at (7, 9) completes the five
    expect(checkFive(board, 7, 9, "black")).toBe(true);
    // Placing at (7, 4) also completes the five
    expect(checkFive(board, 7, 4, "black")).toBe(true);
  });

  it("detects vertical five", () => {
    const board = createEmptyBoard();
    board[3][7] = "black";
    board[4][7] = "black";
    board[5][7] = "black";
    board[6][7] = "black";

    expect(checkFive(board, 7, 7, "black")).toBe(true);
    expect(checkFive(board, 2, 7, "black")).toBe(true);
  });

  it("detects diagonal five", () => {
    const board = createEmptyBoard();
    board[3][3] = "black";
    board[4][4] = "black";
    board[5][5] = "black";
    board[6][6] = "black";

    expect(checkFive(board, 7, 7, "black")).toBe(true);
    expect(checkFive(board, 2, 2, "black")).toBe(true);
  });

  it("returns false when only four stones", () => {
    const board = createEmptyBoard();
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";

    expect(checkFive(board, 7, 8, "black")).toBe(false);
  });

  it("returns false for six (overline)", () => {
    const board = createEmptyBoard();
    board[7][4] = "black";
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";

    // This would make 6, not exactly 5
    expect(checkFive(board, 7, 9, "black")).toBe(false);
  });
});

describe("checkWin", () => {
  it("detects win condition after last move", () => {
    const board = createEmptyBoard();
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";
    board[7][9] = "black";

    expect(checkWin(board, { row: 7, col: 7 }, "black")).toBe(true);
  });

  it("returns false when no five", () => {
    const board = createEmptyBoard();
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";

    expect(checkWin(board, { row: 7, col: 7 }, "black")).toBe(false);
  });
});

describe("checkForbiddenMove", () => {
  describe("overline (long connection)", () => {
    it("detects overline as forbidden", () => {
      const board = createEmptyBoard();
      // 5 black stones in a row, placing 6th would be overline
      board[7][4] = "black";
      board[7][5] = "black";
      board[7][6] = "black";
      board[7][7] = "black";
      board[7][8] = "black";

      const result = checkForbiddenMove(board, 7, 9);
      expect(result.isForbidden).toBe(true);
      expect(result.type).toBe("overline");
    });
  });

  describe("double-three", () => {
    it("detects double-three as forbidden", () => {
      const board = createEmptyBoard();
      // Create a position where placing a stone creates two open threes
      // Horizontal open two
      board[7][6] = "black";
      board[7][8] = "black";
      // Vertical open two
      board[6][7] = "black";
      board[8][7] = "black";

      const result = checkForbiddenMove(board, 7, 7);
      expect(result.isForbidden).toBe(true);
      expect(result.type).toBe("double-three");
    });
  });

  describe("double-four", () => {
    it("detects double-four as forbidden", () => {
      const board = createEmptyBoard();
      // Create a position where placing a stone creates two fours
      // Horizontal: X X . X at row 7, cols 5,6,_,8
      board[7][5] = "black";
      board[7][6] = "black";
      board[7][8] = "black";
      // Vertical: X X . X at col 7, rows 5,6,_,8
      board[5][7] = "black";
      board[6][7] = "black";
      board[8][7] = "black";

      // Placing at (7, 7) creates two fours
      const result = checkForbiddenMove(board, 7, 7);
      expect(result.isForbidden).toBe(true);
      expect(result.type).toBe("double-four");
    });
  });

  describe("five overrides forbidden", () => {
    it("five is not forbidden even with double-three pattern", () => {
      const board = createEmptyBoard();
      // Create a five in the making that would also be double-three
      board[7][3] = "black";
      board[7][4] = "black";
      board[7][5] = "black";
      board[7][6] = "black";

      // Placing at (7, 7) makes five, should not be forbidden
      const result = checkForbiddenMove(board, 7, 7);
      expect(result.isForbidden).toBe(false);
    });
  });

  it("returns not forbidden for empty position with no pattern", () => {
    const board = createEmptyBoard();
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false);
    expect(result.type).toBeNull();
  });

  it("returns not forbidden for already occupied position", () => {
    const board = createEmptyBoard();
    board[7][7] = "black";

    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false);
  });
});

describe("recognizePattern", () => {
  it("recognizes five", () => {
    const board = createEmptyBoard();
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";

    const patterns = recognizePattern(board, 7, 9, "black");
    expect(patterns.some((p) => p.type === "five")).toBe(true);
  });

  it("recognizes open-three", () => {
    const board = createEmptyBoard();
    // _ X X _ pattern - placing at col 8 creates open three
    board[7][6] = "black";
    board[7][7] = "black";

    const patterns = recognizePattern(board, 7, 8, "black");
    expect(patterns.some((p) => p.type === "open-three")).toBe(true);
  });

  it("recognizes open-four", () => {
    const board = createEmptyBoard();
    // _ X X X _ pattern - placing makes open four
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";

    const patterns = recognizePattern(board, 7, 8, "black");
    expect(patterns.some((p) => p.type === "open-four")).toBe(true);
  });

  it("recognizes overline", () => {
    const board = createEmptyBoard();
    board[7][4] = "black";
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";

    const patterns = recognizePattern(board, 7, 9, "black");
    expect(patterns.some((p) => p.type === "overline")).toBe(true);
  });

  it("returns empty array when no patterns", () => {
    const board = createEmptyBoard();
    board[7][7] = "black";

    const patterns = recognizePattern(board, 7, 8, "black");
    expect(patterns).toHaveLength(0);
  });
});
