/**
 * linePatterns テスト
 *
 * analyzeLinePattern が analyzeDirection と全石×4方向で完全一致することを検証。
 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { BOARD_SIZE } from "@/constants";

import { DIRECTIONS } from "../core/constants";
import { analyzeDirection } from "../evaluation/directionAnalysis";
import { CELL_LINES_FLAT } from "./lineMapping";
import { analyzeLinePattern } from "./linePatterns";
import { buildLineTable } from "./lineTable";

/** 空盤を生成 */
function emptyBoard(): BoardState {
  return Array.from({ length: BOARD_SIZE }, (): (null | "black" | "white")[] =>
    Array.from({ length: BOARD_SIZE }, (): null => null),
  );
}

/** 盤面のセルに安全に値をセット */
function setCell(
  board: BoardState,
  r: number,
  c: number,
  value: "black" | "white" | null,
): void {
  const row = board[r];
  if (row) {
    row[c] = value;
  }
}

/** シード付き擬似乱数生成器 */
function createRng(seed: number): () => number {
  let s = seed;
  return (): number => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff; // eslint-disable-line no-bitwise
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
  // Fisher-Yates shuffle
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = positions[i];
    positions[i] = positions[j] ?? { r: 0, c: 0 };
    positions[j] = tmp ?? { r: 0, c: 0 };
  }
  for (let i = 0; i < stoneCount && i < positions.length; i++) {
    const pos = positions[i];
    if (!pos) {
      continue;
    }
    const { r, c } = pos;
    setCell(board, r, c, i % 2 === 0 ? "black" : "white");
  }
  return board;
}

/**
 * 盤面上の全石について、analyzeDirection と analyzeLinePattern の出力を比較
 */
function verifyBoardMatch(board: BoardState): void {
  const lt = buildLineTable(board);

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const stone = board[r]?.[c];
      if (stone === null || stone === undefined) {
        continue;
      }

      for (let dirIdx = 0; dirIdx < DIRECTIONS.length; dirIdx++) {
        const dir = DIRECTIONS[dirIdx];
        if (!dir) {
          continue;
        }
        const [dr, dc] = dir;
        const expected = analyzeDirection(board, r, c, dr, dc, stone);

        // eslint-disable-next-line no-bitwise
        const packed = CELL_LINES_FLAT[(r * 15 + c) * 4 + dirIdx] ?? 0xffff;
        if (packed === 0xffff) {
          // このセルにはこの方向のラインがない（短い斜め）
          // analyzeDirection は盤外をedgeとして処理する
          // この場合はスキップ（ラインが5未満の方向は評価対象外）
          continue;
        }
        // eslint-disable-next-line no-bitwise
        const lineId = packed >> 8;
        // eslint-disable-next-line no-bitwise
        const bitPos = packed & 0xff;
        const reversed = dirIdx === 3; // ↗方向はビット方向が逆
        const actual = analyzeLinePattern(
          lt.blacks,
          lt.whites,
          lineId,
          bitPos,
          stone,
          reversed,
        );

        expect(actual, `(${r},${c}) dir=${dirIdx} color=${stone}`).toEqual(
          expected,
        );
      }
    }
  }
}

describe("analyzeLinePattern vs analyzeDirection", () => {
  it("空盤の中央", () => {
    const board = emptyBoard();
    setCell(board, 7, 7, "black");
    verifyBoardMatch(board);
  });

  it("横一列5連", () => {
    const board = emptyBoard();
    for (let c = 3; c <= 7; c++) {
      setCell(board, 7, c, "black");
    }
    verifyBoardMatch(board);
  });

  it("盤端の石", () => {
    const board = emptyBoard();
    setCell(board, 0, 0, "black");
    setCell(board, 0, 14, "white");
    setCell(board, 14, 0, "white");
    setCell(board, 14, 14, "black");
    setCell(board, 0, 7, "black");
    setCell(board, 7, 0, "white");
    setCell(board, 14, 7, "black");
    setCell(board, 7, 14, "white");
    verifyBoardMatch(board);
  });

  it("斜め↗方向の石列", () => {
    const board = emptyBoard();
    // (10,4) → (9,5) → (8,6) → (7,7) → (6,8) の↗斜め
    setCell(board, 10, 4, "black");
    setCell(board, 9, 5, "black");
    setCell(board, 8, 6, "black");
    setCell(board, 7, 7, "black");
    setCell(board, 6, 8, "white"); // 相手石で端がopponent
    verifyBoardMatch(board);
  });

  it("長連（6連）", () => {
    const board = emptyBoard();
    for (let c = 2; c <= 7; c++) {
      setCell(board, 7, c, "black");
    }
    verifyBoardMatch(board);
  });

  it("混在パターン（黒白隣接）", () => {
    const board = emptyBoard();
    setCell(board, 7, 5, "black");
    setCell(board, 7, 6, "black");
    setCell(board, 7, 7, "black");
    setCell(board, 7, 8, "white");
    setCell(board, 7, 9, "white");
    verifyBoardMatch(board);
  });

  const RANDOM_BOARD_COUNT = 200;
  const STONE_COUNTS = [6, 12, 20, 30];

  for (const stoneCount of STONE_COUNTS) {
    it(`ランダム盤面 ${RANDOM_BOARD_COUNT}局 (${stoneCount}石) で完全一致`, () => {
      const rng = createRng(stoneCount * 12345);
      for (let i = 0; i < RANDOM_BOARD_COUNT; i++) {
        const board = randomBoard(rng, stoneCount);
        verifyBoardMatch(board);
      }
    });
  }
});
