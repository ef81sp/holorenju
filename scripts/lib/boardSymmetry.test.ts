/**
 * D4群（恒等・回転3・鏡映4）の盤面変換とcanonical keyのテスト。
 * opening-trap-mining-2026-07-16.md §6 の canonical key 定義（盤面の225セル文字列
 * + 手番を、盤の8対称変換すべてに適用した際の辞書順最小値）を固定する。
 */
import { describe, expect, it } from "vitest";

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import { createEmptyBoard } from "@/logic/renjuRules";

import {
  D4_TRANSFORMS,
  type CoordTransform,
  boardToString,
  canonicalKey,
  transformBoard,
} from "./boardSymmetry";

function findTransform(name: string): CoordTransform {
  const { transform } = D4_TRANSFORMS.find((t) => t.name === name)!;
  return transform;
}

describe("D4_TRANSFORMS", () => {
  it("8変換すべてが全単射（全マスをちょうど1回ずつカバー）", () => {
    for (const { name, transform } of D4_TRANSFORMS) {
      const seen = new Set<string>();
      for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
          const dest = transform(row, col);
          expect(dest.row, `${name}: row範囲`).toBeGreaterThanOrEqual(0);
          expect(dest.row, `${name}: row範囲`).toBeLessThan(BOARD_SIZE);
          expect(dest.col, `${name}: col範囲`).toBeGreaterThanOrEqual(0);
          expect(dest.col, `${name}: col範囲`).toBeLessThan(BOARD_SIZE);
          const key = `${dest.row},${dest.col}`;
          expect(seen.has(key), `${name}: 重複 ${key}`).toBe(false);
          seen.add(key);
        }
      }
      expect(seen.size).toBe(BOARD_SIZE * BOARD_SIZE);
    }
  });

  it("回転90を4回合成すると恒等に戻る（群の位数）", () => {
    const rotate90 = findTransform("rotate90");
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        let pos: Position = { row, col };
        for (let i = 0; i < 4; i++) {
          pos = rotate90(pos.row, pos.col);
        }
        expect(pos).toEqual({ row, col });
      }
    }
  });

  it("回転180を2回合成すると恒等に戻る", () => {
    const rotate180 = findTransform("rotate180");
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const once = rotate180(row, col);
        const twice = rotate180(once.row, once.col);
        expect(twice).toEqual({ row, col });
      }
    }
  });

  it.each([
    "flipHorizontal",
    "flipVertical",
    "flipDiagonal",
    "flipAntiDiagonal",
  ])("鏡映 %s を2回合成すると恒等に戻る（位数2）", (name) => {
    const transform = findTransform(name);
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const once = transform(row, col);
        const twice = transform(once.row, once.col);
        expect(twice).toEqual({ row, col });
      }
    }
  });

  it("回転90を3回合成した結果は回転270と一致する（群の閉性）", () => {
    const rotate90 = findTransform("rotate90");
    const rotate270 = findTransform("rotate270");
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        let pos: Position = { row, col };
        for (let i = 0; i < 3; i++) {
          pos = rotate90(pos.row, pos.col);
        }
        expect(pos).toEqual(rotate270(row, col));
      }
    }
  });
});

function boardWith(
  stones: { row: number; col: number; color: "black" | "white" }[],
): BoardState {
  const board = createEmptyBoard();
  for (const { row, col, color } of stones) {
    board[row]![col] = color;
  }
  return board;
}

describe("transformBoard / boardToString", () => {
  it("恒等変換は盤面を変えない", () => {
    const board = boardWith([{ row: 3, col: 5, color: "black" }]);
    const identity = findTransform("identity");
    const transformed = transformBoard(board, identity);
    expect(boardToString(transformed)).toBe(boardToString(board));
  });

  it("回転90は石の座標を実際に回転させる", () => {
    const board = boardWith([{ row: 0, col: 0, color: "black" }]);
    const rotate90 = findTransform("rotate90");
    const transformed = transformBoard(board, rotate90);
    const expectedDest = rotate90(0, 0);
    expect(transformed[expectedDest.row]![expectedDest.col]).toBe("black");
  });
});

describe("canonicalKey", () => {
  it("90度回転させた局面は同一canonicalKeyを持つ（対称局面）", () => {
    const boardA = boardWith([
      { row: 3, col: 5, color: "black" },
      { row: 7, col: 7, color: "white" },
    ]);
    const rotate90 = findTransform("rotate90");
    const boardB = transformBoard(boardA, rotate90);
    expect(canonicalKey(boardA, "black")).toBe(canonicalKey(boardB, "black"));
  });

  it("鏡映させた局面は同一canonicalKeyを持つ（対称局面）", () => {
    const boardA = boardWith([
      { row: 2, col: 9, color: "black" },
      { row: 10, col: 3, color: "white" },
      { row: 7, col: 7, color: "black" },
    ]);
    const flip = findTransform("flipAntiDiagonal");
    const boardB = transformBoard(boardA, flip);
    expect(canonicalKey(boardA, "white")).toBe(canonicalKey(boardB, "white"));
  });

  it("非対称な2局面は異なるcanonicalKeyを持つ", () => {
    const boardA = boardWith([{ row: 3, col: 5, color: "black" }]);
    const boardB = boardWith([{ row: 4, col: 9, color: "black" }]);
    expect(canonicalKey(boardA, "black")).not.toBe(
      canonicalKey(boardB, "black"),
    );
  });

  it("同一盤面でも手番が異なればcanonicalKeyが異なる", () => {
    const board = boardWith([{ row: 3, col: 5, color: "black" }]);
    expect(canonicalKey(board, "black")).not.toBe(canonicalKey(board, "white"));
  });
});
