/**
 * lineTable テスト
 *
 * LineTable のCRUD操作を検証する。
 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { BOARD_SIZE } from "@/constants";

import { getCellLines, LINE_LENGTHS } from "./lineMapping";
import {
  buildLineTable,
  createEmptyLineTable,
  placeStone,
  removeStone,
} from "./lineTable";

describe("createEmptyLineTable", () => {
  it("blacks/whites が72要素のUint16Arrayで全て0", () => {
    const lt = createEmptyLineTable();
    expect(lt.blacks).toBeInstanceOf(Uint16Array);
    expect(lt.whites).toBeInstanceOf(Uint16Array);
    expect(lt.blacks).toHaveLength(72);
    expect(lt.whites).toHaveLength(72);
    for (let i = 0; i < 72; i++) {
      expect(lt.blacks[i]).toBe(0);
      expect(lt.whites[i]).toBe(0);
    }
  });
});

describe("placeStone / removeStone", () => {
  it("中央 (7,7) に黒石を配置→4ラインの対応ビットが1", () => {
    const lt = createEmptyLineTable();
    placeStone(lt, 7, 7, "black");

    const entries = getCellLines(7, 7);
    expect(entries).toHaveLength(4);

    for (const entry of entries) {
      // eslint-disable-next-line no-bitwise
      expect((lt.blacks[entry.lineId] ?? 0) & (1 << entry.bitPos)).not.toBe(0);
      // 白は未変更
      expect(lt.whites[entry.lineId]).toBe(0);
    }
  });

  it("白石配置は whites のみ変更", () => {
    const lt = createEmptyLineTable();
    placeStone(lt, 3, 5, "white");

    const entries = getCellLines(3, 5);
    for (const entry of entries) {
      expect(lt.blacks[entry.lineId]).toBe(0);
      // eslint-disable-next-line no-bitwise
      expect((lt.whites[entry.lineId] ?? 0) & (1 << entry.bitPos)).not.toBe(0);
    }
  });

  it("placeStone → removeStone でビットマスクが元通り", () => {
    const lt = createEmptyLineTable();
    placeStone(lt, 7, 7, "black");
    removeStone(lt, 7, 7, "black");

    for (let i = 0; i < 72; i++) {
      expect(lt.blacks[i]).toBe(0);
      expect(lt.whites[i]).toBe(0);
    }
  });

  it("複数石の独立管理", () => {
    const lt = createEmptyLineTable();
    placeStone(lt, 7, 7, "black");
    placeStone(lt, 7, 8, "white");
    placeStone(lt, 0, 0, "black");

    // (7,7) の黒ビットが立っている
    const entries77 = getCellLines(7, 7);
    for (const entry of entries77) {
      // eslint-disable-next-line no-bitwise
      expect((lt.blacks[entry.lineId] ?? 0) & (1 << entry.bitPos)).not.toBe(0);
    }

    // (7,8) の白ビットが立っている
    const entries78 = getCellLines(7, 8);
    for (const entry of entries78) {
      // eslint-disable-next-line no-bitwise
      expect((lt.whites[entry.lineId] ?? 0) & (1 << entry.bitPos)).not.toBe(0);
    }

    // (7,8) に黒を置いていないので黒ビットはない（横ラインで共有されているが別bitPos）
    // 横ラインでは lineId=7 が共有されるので、黒の bitPos=7 が (7,7)、白の bitPos=8 が (7,8)
    const row7HorizBlack = lt.blacks[7] ?? 0;
    // eslint-disable-next-line no-bitwise
    expect(row7HorizBlack & (1 << 7)).not.toBe(0); // (7,7) の黒
    // eslint-disable-next-line no-bitwise
    expect(row7HorizBlack & (1 << 8)).toBe(0); // (7,8) に黒はない
  });

  it("角セル (0,0) の配置→除去", () => {
    const lt = createEmptyLineTable();
    placeStone(lt, 0, 0, "black");

    const entries = getCellLines(0, 0);
    // (0,0) は斜め↗がないので3エントリ
    expect(entries).toHaveLength(3);

    for (const entry of entries) {
      // eslint-disable-next-line no-bitwise
      expect((lt.blacks[entry.lineId] ?? 0) & (1 << entry.bitPos)).not.toBe(0);
    }

    removeStone(lt, 0, 0, "black");
    for (let i = 0; i < 72; i++) {
      expect(lt.blacks[i]).toBe(0);
    }
  });

  it("角セル (14,14) の配置→除去", () => {
    const lt = createEmptyLineTable();
    placeStone(lt, 14, 14, "white");

    const entries = getCellLines(14, 14);
    for (const entry of entries) {
      // eslint-disable-next-line no-bitwise
      expect((lt.whites[entry.lineId] ?? 0) & (1 << entry.bitPos)).not.toBe(0);
    }

    removeStone(lt, 14, 14, "white");
    for (let i = 0; i < 72; i++) {
      expect(lt.whites[i]).toBe(0);
    }
  });
});

describe("buildLineTable", () => {
  /** 空盤を生成 */
  function emptyBoard(): BoardState {
    return Array.from(
      { length: BOARD_SIZE },
      (): (null | "black" | "white")[] =>
        Array.from({ length: BOARD_SIZE }, (): null => null),
    );
  }

  it("空盤→全ビットマスク0", () => {
    const board = emptyBoard();
    const lt = buildLineTable(board);
    for (let i = 0; i < 72; i++) {
      expect(lt.blacks[i]).toBe(0);
      expect(lt.whites[i]).toBe(0);
    }
  });

  it("buildLineTable と手動 placeStone の結果が一致", () => {
    const board = emptyBoard();
    const positions: { row: number; col: number; color: "black" | "white" }[] =
      [
        { row: 7, col: 7, color: "black" },
        { row: 7, col: 8, color: "white" },
        { row: 8, col: 8, color: "black" },
        { row: 6, col: 6, color: "white" },
        { row: 0, col: 0, color: "black" },
        { row: 14, col: 14, color: "white" },
        { row: 0, col: 14, color: "black" },
        { row: 14, col: 0, color: "white" },
      ];

    // 盤面に配置
    for (const p of positions) {
      const row = board[p.row];
      if (row) {
        row[p.col] = p.color;
      }
    }

    // buildLineTable で一括構築
    const ltBuild = buildLineTable(board);

    // placeStone で手動構築
    const ltManual = createEmptyLineTable();
    for (const p of positions) {
      placeStone(ltManual, p.row, p.col, p.color);
    }

    // 全72ラインで一致
    for (let i = 0; i < 72; i++) {
      expect(ltBuild.blacks[i]).toBe(ltManual.blacks[i]);
      expect(ltBuild.whites[i]).toBe(ltManual.whites[i]);
    }
  });

  it("黒白のビットマスクが独立（同一ビット位置に立たない）", () => {
    const board = emptyBoard();
    // ランダムっぽい配置
    const moves = [
      [7, 7, "black"],
      [7, 8, "white"],
      [8, 7, "black"],
      [8, 8, "white"],
      [6, 9, "black"],
      [9, 6, "white"],
    ] as const;

    for (const [r, c, color] of moves) {
      const row = board[r];
      if (row) {
        row[c] = color;
      }
    }

    const lt = buildLineTable(board);

    // 全ラインで黒と白のビットが重複しない
    for (let i = 0; i < 72; i++) {
      // eslint-disable-next-line no-bitwise
      expect((lt.blacks[i] ?? 0) & (lt.whites[i] ?? 0)).toBe(0);
    }
  });

  it("buildLineTable の各ビットが正しいラインに対応", () => {
    const board = emptyBoard();
    if (board[3]) {
      board[3][5] = "black";
    }

    const lt = buildLineTable(board);
    const entries = getCellLines(3, 5);

    // 対応ラインのビットが立っている
    for (const entry of entries) {
      // eslint-disable-next-line no-bitwise
      expect((lt.blacks[entry.lineId] ?? 0) & (1 << entry.bitPos)).not.toBe(0);
    }

    // 対応ライン以外のビットはすべて0（1石しかないので）
    for (let i = 0; i < 72; i++) {
      if (entries.some((e) => e.lineId === i)) {
        continue;
      }
      expect(lt.blacks[i]).toBe(0);
    }
  });

  it("横一列に5石配置→横ラインのビットマスクが連続5ビット", () => {
    const board = emptyBoard();
    for (let c = 3; c <= 7; c++) {
      if (board[7]) {
        board[7][c] = "black";
      }
    }

    const lt = buildLineTable(board);
    // 横ライン lineId=7 の bitPos 3~7 が立っている
    // eslint-disable-next-line no-bitwise
    const expected = 0b11111 << 3;
    expect(lt.blacks[7]).toBe(expected);
  });

  it("全ラインのビット数が LINE_LENGTHS を超えない", () => {
    const board = emptyBoard();
    // 全セルに交互に配置
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const row = board[r];
        if (row) {
          row[c] = (r + c) % 2 === 0 ? "black" : "white";
        }
      }
    }

    const lt = buildLineTable(board);
    for (let i = 0; i < 72; i++) {
      const mask = (lt.blacks[i] ?? 0) | (lt.whites[i] ?? 0); // eslint-disable-line no-bitwise
      const maxBit = LINE_LENGTHS[i] ?? 0;
      // mask が maxBit ビット以内に収まっている
      // eslint-disable-next-line no-bitwise
      expect(mask >> maxBit).toBe(0);
    }
  });
});
