/**
 * adapter テスト
 *
 * getDirectionPattern の黒オーバーライン四スコア補正を
 * lineTable 有り/無しの両パスで検証。
 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { BOARD_SIZE } from "@/constants";

import { getPatternScore } from "../evaluation/directionAnalysis";
import { PATTERN_SCORES } from "../evaluation/patternScores";
import { getDirectionPattern } from "./adapter";
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

/**
 * lineTable 有り/無し両パスで getDirectionPattern を検証するヘルパー
 */
function assertPattern(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: "black" | "white",
  expectedCount: number,
  expectedScore: number,
): void {
  const lt = buildLineTable(board);

  // lineTable なし（analyzeDirection パス）
  const withoutLt = getDirectionPattern(board, row, col, dirIndex, color);
  expect(withoutLt.count, "without LT: count").toBe(expectedCount);
  expect(getPatternScore(withoutLt, color), "without LT: score").toBe(
    expectedScore,
  );

  // lineTable あり（analyzeLinePattern パス）
  const withLt = getDirectionPattern(board, row, col, dirIndex, color, lt);
  expect(withLt.count, "with LT: count").toBe(expectedCount);
  expect(getPatternScore(withLt, color), "with LT: score").toBe(expectedScore);

  // 両パスで結果一致
  expect(withLt, "LT parity").toEqual(withoutLt);
}

describe("黒オーバーライン四スコア補正", () => {
  it("片端オーバーライン: _ ● ● ● ★ _ ● → FOUR (1500)", () => {
    // 横方向 (dirIndex=0), row=7
    // col: 3=empty, 4=black, 5=black, 6=black, 7=★black, 8=empty, 9=black
    const board = emptyBoard();
    setCell(board, 7, 4, "black");
    setCell(board, 7, 5, "black");
    setCell(board, 7, 6, "black");
    setCell(board, 7, 7, "black"); // ★
    setCell(board, 7, 9, "black"); // gap の先の黒石

    // ★(7,7) から横方向: count=4, end1(右)=empty, end2(左)=empty
    // ただし end1(右) の先(col=9)に黒石 → オーバーライン → end1="opponent"
    assertPattern(board, 7, 7, 0, "black", 4, PATTERN_SCORES.FOUR);
  });

  it("両端オーバーライン: ● _ ● ● ● ★ _ ● → score=0", () => {
    // col: 2=black, 3=empty, 4=black, 5=black, 6=black, 7=★black, 8=empty, 9=black
    const board = emptyBoard();
    setCell(board, 7, 2, "black");
    setCell(board, 7, 4, "black");
    setCell(board, 7, 5, "black");
    setCell(board, 7, 6, "black");
    setCell(board, 7, 7, "black"); // ★
    setCell(board, 7, 9, "black");

    // ★(7,7) から横方向: count=4 (col 4,5,6,7), 両端 empty
    // end1(右,col=8)=empty → beyond(col=9)=black → overline
    // end2(左,col=3)=empty → beyond(col=2)=black → overline
    // 両端塞がり → score=0
    assertPattern(board, 7, 7, 0, "black", 4, 0);
  });

  it("オーバーラインなし: _ ● ● ● ★ _ → OPEN_FOUR (10000)", () => {
    const board = emptyBoard();
    setCell(board, 7, 4, "black");
    setCell(board, 7, 5, "black");
    setCell(board, 7, 6, "black");
    setCell(board, 7, 7, "black"); // ★

    // 両端 empty、先に黒石なし → 通常の活四
    assertPattern(board, 7, 7, 0, "black", 4, PATTERN_SCORES.OPEN_FOUR);
  });

  it("白は影響なし: _ ○ ○ ○ ○ _ ○ → OPEN_FOUR (10000)", () => {
    const board = emptyBoard();
    setCell(board, 7, 4, "white");
    setCell(board, 7, 5, "white");
    setCell(board, 7, 6, "white");
    setCell(board, 7, 7, "white");
    setCell(board, 7, 9, "white"); // gap の先

    // 白は長連禁なし → 通常の活四のまま
    assertPattern(board, 7, 7, 0, "white", 4, PATTERN_SCORES.OPEN_FOUR);
  });

  it("斜め↘ (dirIndex=2) 片端オーバーライン → FOUR", () => {
    // ↘方向: (r+1,c+1) が正方向
    // (3,3),(4,4),(5,5),(6,6)=★, gap(7,7)=empty, (8,8)=black
    const board = emptyBoard();
    setCell(board, 3, 3, "black");
    setCell(board, 4, 4, "black");
    setCell(board, 5, 5, "black");
    setCell(board, 6, 6, "black"); // ★
    setCell(board, 8, 8, "black"); // gap の先の黒石

    assertPattern(board, 6, 6, 2, "black", 4, PATTERN_SCORES.FOUR);
  });

  it("斜め↗ (dirIndex=3) 片端オーバーライン → FOUR", () => {
    // ↗方向: (r-1,c+1) が正方向 → dirIndex=3 ではビット方向が逆
    // (10,3),(9,4),(8,5),(7,6)=★, gap(6,7)=empty, (5,8)=black
    const board = emptyBoard();
    setCell(board, 10, 3, "black");
    setCell(board, 9, 4, "black");
    setCell(board, 8, 5, "black");
    setCell(board, 7, 6, "black"); // ★
    setCell(board, 5, 8, "black"); // gap の先の黒石

    assertPattern(board, 7, 6, 3, "black", 4, PATTERN_SCORES.FOUR);
  });

  it("端に近い位置でオーバーライン判定が盤外アクセスしない", () => {
    // col: 11=black, 12=black, 13=black, 14=★black
    // end1(右)=edge, end2(左,col=10)=empty → beyond(col=9)にはない
    const board = emptyBoard();
    setCell(board, 7, 11, "black");
    setCell(board, 7, 12, "black");
    setCell(board, 7, 13, "black");
    setCell(board, 7, 14, "black"); // ★ 端

    // end1=edge, end2=empty → FOUR (片方edge、片方empty)
    assertPattern(board, 7, 14, 0, "black", 4, PATTERN_SCORES.FOUR);
  });

  it("empty の先が空 → 通常通り活四", () => {
    // _ _ ● ● ● ★ _ _ → 両端 empty で beyond は空
    const board = emptyBoard();
    setCell(board, 7, 5, "black");
    setCell(board, 7, 6, "black");
    setCell(board, 7, 7, "black");
    setCell(board, 7, 8, "black"); // ★

    assertPattern(board, 7, 8, 0, "black", 4, PATTERN_SCORES.OPEN_FOUR);
  });
});
