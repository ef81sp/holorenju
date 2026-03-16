/**
 * detectOpponentThreatsFast の等価性テスト
 *
 * ランダム盤面と固定盤面で detectOpponentThreats と結果が完全一致することを確認。
 */

import { describe, expect, it } from "vitest";

import type { BoardState, StoneColor } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

import type { ThreatInfo } from "./patternScores";

import { buildLineTable } from "../lineTable/lineTable";
import { placeStonesOnBoard } from "../testUtils";
import { detectOpponentThreats } from "./threatDetection";
import { detectOpponentThreatsFast } from "./threatDetectionFast";

/** Position配列をソートキーに変換して比較可能にする */
function sortPositions(
  positions: { row: number; col: number }[],
): { row: number; col: number }[] {
  return [...positions].sort(
    (a, b) => a.row * 15 + a.col - (b.row * 15 + b.col),
  );
}

/** ThreatInfo の全フィールドをソートして比較可能にする */
function normalizeThreatInfo(info: ThreatInfo): ThreatInfo {
  return {
    openFours: sortPositions(info.openFours),
    fours: sortPositions(info.fours),
    openThrees: sortPositions(info.openThrees),
    mises: sortPositions(info.mises),
    doubleThrees: sortPositions(info.doubleThrees),
  };
}

/** ランダムな盤面を生成 */
/* eslint-disable no-bitwise -- LCG 乱数生成に必要 */
function randomBoard(stoneCount: number, seed: number): BoardState {
  const board = createEmptyBoard();
  let rng = seed;
  const nextRng = (): number => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng;
  };

  const positions: { row: number; col: number }[] = [];
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      positions.push({ row: r, col: c });
    }
  }
  // Fisher-Yates shuffle
  for (let i = positions.length - 1; i > 0; i--) {
    const j = nextRng() % (i + 1);
    [positions[i], positions[j]] = [positions[j]!, positions[i]!];
  }

  for (let i = 0; i < Math.min(stoneCount, 225); i++) {
    const pos = positions[i]!;
    const color: StoneColor = i % 2 === 0 ? "black" : "white";
    const row = board[pos.row];
    if (row) {
      row[pos.col] = color;
    }
  }
  return board;
}
/* eslint-enable no-bitwise */

function assertEquivalent(
  board: BoardState,
  opponentColor: "black" | "white",
  label: string,
): void {
  const lineTable = buildLineTable(board);
  const expected = detectOpponentThreats(board, opponentColor);
  const actual = detectOpponentThreatsFast(board, opponentColor, lineTable);

  const normalizedExpected = normalizeThreatInfo(expected);
  const normalizedActual = normalizeThreatInfo(actual);

  expect(normalizedActual.openFours, `${label}: openFours`).toEqual(
    normalizedExpected.openFours,
  );
  expect(normalizedActual.fours, `${label}: fours`).toEqual(
    normalizedExpected.fours,
  );
  expect(normalizedActual.openThrees, `${label}: openThrees`).toEqual(
    normalizedExpected.openThrees,
  );
  expect(normalizedActual.mises, `${label}: mises`).toEqual(
    normalizedExpected.mises,
  );
  expect(normalizedActual.doubleThrees, `${label}: doubleThrees`).toEqual(
    normalizedExpected.doubleThrees,
  );
}

describe("detectOpponentThreatsFast 等価性", () => {
  it("空盤", () => {
    const board = createEmptyBoard();
    assertEquivalent(board, "black", "空盤-black");
    assertEquivalent(board, "white", "空盤-white");
  });

  it("活四パターン", () => {
    const board = createEmptyBoard();
    // 黒の活四: ・●●●●・
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 0, col: 0, color: "white" },
    ]);
    assertEquivalent(board, "black", "黒活四");
  });

  it("止め四パターン", () => {
    const board = createEmptyBoard();
    // 黒の止め四: ○●●●●・
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    assertEquivalent(board, "black", "黒止め四");
  });

  it("活三パターン", () => {
    const board = createEmptyBoard();
    // 黒の活三: ・●●●・
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 0, col: 0, color: "white" },
    ]);
    assertEquivalent(board, "black", "黒活三");
  });

  it("跳び四パターン", () => {
    const board = createEmptyBoard();
    // 黒の跳び四: ●●・●●
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      // col: 6 は空（跳び）
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "black" },
      { row: 0, col: 0, color: "white" },
    ]);
    assertEquivalent(board, "black", "黒跳び四");
  });

  it("跳び三パターン", () => {
    const board = createEmptyBoard();
    // 黒の跳び三: ・●●・●・
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      // col: 6 は空（跳び）
      { row: 7, col: 7, color: "black" },
      { row: 0, col: 0, color: "white" },
    ]);
    assertEquivalent(board, "black", "黒跳び三");
  });

  it("盤端ライン", () => {
    const board = createEmptyBoard();
    // 盤端の活三
    placeStonesOnBoard(board, [
      { row: 0, col: 0, color: "black" },
      { row: 0, col: 1, color: "black" },
      { row: 0, col: 2, color: "black" },
      { row: 14, col: 14, color: "white" },
    ]);
    assertEquivalent(board, "black", "盤端-black");
  });

  it("禁手絡み（黒の三三）", () => {
    const board = createEmptyBoard();
    // 黒の三三が絡む局面
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 0, col: 0, color: "white" },
      { row: 14, col: 14, color: "white" },
    ]);
    assertEquivalent(board, "black", "禁手絡み");
  });

  it("白のミセ手・三三検出", () => {
    const board = createEmptyBoard();
    // 白の複合脅威
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 8, col: 6, color: "white" },
      { row: 9, col: 6, color: "white" },
      { row: 0, col: 0, color: "black" },
      { row: 14, col: 14, color: "black" },
    ]);
    assertEquivalent(board, "white", "白ミセ手");
  });

  it("ランダム盤面100局で完全一致", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const stoneCount = 8 + (seed % 15); // 8〜22 stones
      const board = randomBoard(stoneCount, seed);
      assertEquivalent(board, "black", `random-${seed}-black`);
      assertEquivalent(board, "white", `random-${seed}-white`);
    }
  });
});
