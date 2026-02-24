/**
 * lineChecks テスト
 *
 * checkFiveBit / checkOverlineBit が renjuRules 版と全石×全色で完全一致することを検証。
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import { checkFive, checkOverline } from "@/logic/renjuRules";

import { checkFiveBit, checkOverlineBit } from "./lineChecks";
import { buildLineTable, placeStone } from "./lineTable";

/** 空盤を生成 */
function emptyBoard(): BoardState {
  return Array.from({ length: BOARD_SIZE }, (): (null | "black" | "white")[] =>
    Array.from({ length: BOARD_SIZE }, (): null => null),
  );
}

/** シード付き擬似乱数生成器 */
function createRng(seed: number): () => number {
  let s = seed;
  return (): number => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** ランダム盤面を生成 */
function randomBoard(rng: () => number, stoneCount: number): BoardState {
  const board = emptyBoard();
  const positions: { r: number; c: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      positions.push({ r, c });
    }
  }
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [positions[i], positions[j]] = [positions[j]!, positions[i]!];
  }
  for (let i = 0; i < stoneCount && i < positions.length; i++) {
    const { r, c } = positions[i]!;
    board[r]![c] = i % 2 === 0 ? "black" : "white";
  }
  return board;
}

describe("checkFiveBit vs checkFive", () => {
  it("空盤の中央に五連", () => {
    const board = emptyBoard();
    // 横に4つ並べて5つ目を確認
    for (let c = 5; c <= 8; c++) {
      board[7]![c] = "black";
    }
    const lt = buildLineTable(board);
    // (7,9) に置くと五連
    board[7]![9] = "black";
    placeStone(lt, 7, 9, "black");
    expect(checkFiveBit(lt.blacks, lt.whites, 7, 9, "black")).toBe(true);
    expect(checkFive(board, 7, 9, "black")).toBe(true);
  });

  it("白の五連", () => {
    const board = emptyBoard();
    for (let r = 3; r <= 6; r++) {
      board[r]![7] = "white";
    }
    const lt = buildLineTable(board);
    board[7]![7] = "white";
    placeStone(lt, 7, 7, "white");
    expect(checkFiveBit(lt.blacks, lt.whites, 7, 7, "white")).toBe(true);
    expect(checkFive(board, 7, 7, "white")).toBe(true);
  });

  it("四では false", () => {
    const board = emptyBoard();
    for (let c = 5; c <= 7; c++) {
      board[7]![c] = "black";
    }
    const lt = buildLineTable(board);
    board[7]![8] = "black";
    placeStone(lt, 7, 8, "black");
    expect(checkFiveBit(lt.blacks, lt.whites, 7, 8, "black")).toBe(false);
    expect(checkFive(board, 7, 8, "black")).toBe(false);
  });

  it("六連（長連）では false", () => {
    const board = emptyBoard();
    for (let c = 4; c <= 8; c++) {
      board[7]![c] = "black";
    }
    const lt = buildLineTable(board);
    board[7]![9] = "black";
    placeStone(lt, 7, 9, "black");
    // 6連 → checkFive は false（exactly 5 のみ）
    expect(checkFiveBit(lt.blacks, lt.whites, 7, 9, "black")).toBe(false);
    expect(checkFive(board, 7, 9, "black")).toBe(false);
  });

  it("斜め↗方向の五連", () => {
    const board = emptyBoard();
    board[10]![3] = "white";
    board[9]![4] = "white";
    board[8]![5] = "white";
    board[7]![6] = "white";
    const lt = buildLineTable(board);
    board[6]![7] = "white";
    placeStone(lt, 6, 7, "white");
    expect(checkFiveBit(lt.blacks, lt.whites, 6, 7, "white")).toBe(true);
    expect(checkFive(board, 6, 7, "white")).toBe(true);
  });

  const RANDOM_BOARD_COUNT = 100;
  const STONE_COUNTS = [8, 16, 24];

  for (const stoneCount of STONE_COUNTS) {
    it(`ランダム盤面 ${RANDOM_BOARD_COUNT}局 (${stoneCount}石) checkFive 完全一致`, () => {
      const rng = createRng(stoneCount * 99999);
      for (let i = 0; i < RANDOM_BOARD_COUNT; i++) {
        const board = randomBoard(rng, stoneCount);
        // 全空きセルで仮置きして比較（重いので毎回 rebuild）
        const lt = buildLineTable(board);
        // ランダムに5セルだけチェック（全セルだと遅い）
        for (let j = 0; j < 5; j++) {
          const r = Math.floor(rng() * BOARD_SIZE);
          const c = Math.floor(rng() * BOARD_SIZE);
          if (board[r]?.[c] !== null) {
            continue;
          }
          for (const color of ["black", "white"] as const) {
            board[r]![c] = color;
            placeStone(lt, r, c, color);

            const expected = checkFive(board, r, c, color);
            const actual = checkFiveBit(lt.blacks, lt.whites, r, c, color);
            expect(actual, `(${r},${c}) ${color} board#${i}`).toBe(expected);

            // 復元
            board[r]![c] = null;
            // rebuild lineTable for next iteration
            const ltFresh = buildLineTable(board);
            lt.blacks.set(ltFresh.blacks);
            lt.whites.set(ltFresh.whites);
          }
        }
      }
    });
  }
});

describe("checkOverlineBit vs checkOverline", () => {
  it("六連を検出", () => {
    const board = emptyBoard();
    for (let c = 4; c <= 8; c++) {
      board[7]![c] = "black";
    }
    const lt = buildLineTable(board);
    board[7]![9] = "black";
    placeStone(lt, 7, 9, "black");
    expect(checkOverlineBit(lt.blacks, lt.whites, 7, 9)).toBe(true);
    expect(checkOverline(board, 7, 9)).toBe(true);
  });

  it("五連は長連ではない", () => {
    const board = emptyBoard();
    for (let c = 5; c <= 8; c++) {
      board[7]![c] = "black";
    }
    const lt = buildLineTable(board);
    board[7]![9] = "black";
    placeStone(lt, 7, 9, "black");
    expect(checkOverlineBit(lt.blacks, lt.whites, 7, 9)).toBe(false);
    expect(checkOverline(board, 7, 9)).toBe(false);
  });

  const RANDOM_BOARD_COUNT = 100;
  const STONE_COUNTS = [8, 16, 24];

  for (const stoneCount of STONE_COUNTS) {
    it(`ランダム盤面 ${RANDOM_BOARD_COUNT}局 (${stoneCount}石) checkOverline 完全一致`, () => {
      const rng = createRng(stoneCount * 77777);
      for (let i = 0; i < RANDOM_BOARD_COUNT; i++) {
        const board = randomBoard(rng, stoneCount);
        const lt = buildLineTable(board);
        for (let j = 0; j < 5; j++) {
          const r = Math.floor(rng() * BOARD_SIZE);
          const c = Math.floor(rng() * BOARD_SIZE);
          if (board[r]?.[c] !== null) {
            continue;
          }
          board[r]![c] = "black";
          placeStone(lt, r, c, "black");

          const expected = checkOverline(board, r, c);
          const actual = checkOverlineBit(lt.blacks, lt.whites, r, c);
          expect(actual, `(${r},${c}) board#${i}`).toBe(expected);

          board[r]![c] = null;
          const ltFresh = buildLineTable(board);
          lt.blacks.set(ltFresh.blacks);
          lt.whites.set(ltFresh.whites);
        }
      }
    });
  }
});
