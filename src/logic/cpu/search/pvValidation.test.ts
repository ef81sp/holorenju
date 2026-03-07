/**
 * PV検証のテスト
 *
 * PV（想定手順）が必須防御ルールに違反しないことを検証
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { applyMove } from "../core/boardUtils";
import { placeStonesOnBoard } from "../testUtils";
import { TranspositionTable } from "../transpositionTable";
import { computeBoardHash } from "../zobrist";
import { extractPV, isValidPVMove } from "./results";

describe("isValidPVMove", () => {
  it("五連が作れる手は常に有効", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 五連完成の手
    expect(isValidPVMove(board, { row: 7, col: 7 }, "black")).toBe(true);
  });

  it("相手の活四を無視する手は無効", () => {
    const board = createEmptyBoard();
    // 白の活四: (7,3)-(7,6)の4連で両端空き
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    // 活四を止めない手は無効
    expect(isValidPVMove(board, { row: 0, col: 0 }, "black")).toBe(false);
    // 活四の端を止める手は有効
    expect(isValidPVMove(board, { row: 7, col: 2 }, "black")).toBe(true);
    expect(isValidPVMove(board, { row: 7, col: 7 }, "black")).toBe(true);
  });

  it("相手の活三を無視する手は無効", () => {
    const board = createEmptyBoard();
    // 白の活三: (7,4)-(7,6)の3連で両端空き
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    // 活三を止めない手は無効
    expect(isValidPVMove(board, { row: 0, col: 0 }, "black")).toBe(false);
    // 活三の端を止める手は有効
    expect(isValidPVMove(board, { row: 7, col: 3 }, "black")).toBe(true);
    expect(isValidPVMove(board, { row: 7, col: 7 }, "black")).toBe(true);
  });

  it("脅威がなければどの手も有効", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);

    expect(isValidPVMove(board, { row: 6, col: 6 }, "black")).toBe(true);
    expect(isValidPVMove(board, { row: 0, col: 0 }, "white")).toBe(true);
  });
});

describe("extractPV: 脅威を無視する手でPVを打ち切り", () => {
  it("TTのbestMoveが活三を無視する場合、PVを打ち切る", () => {
    const board = createEmptyBoard();
    // 白の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    const tt = new TranspositionTable(1000);
    const hash = computeBoardHash(board);

    // 白がH8に打つ（PVの最初の手、問題なし）
    const firstMove = { row: 7, col: 7 };
    const boardAfterFirst = applyMove(board, firstMove, "white");
    const hash2 = computeBoardHash(boardAfterFirst);

    // 黒のTTエントリ: 活三を無視して関係ない場所に打つ
    tt.store(hash2, -100, 3, "EXACT", { row: 0, col: 0 });

    const result = extractPV(board, hash, firstMove, "white", tt);

    // 黒の不正な手でPVが打ち切られる（firstMoveのみ）
    expect(result.pv).toHaveLength(1);
    expect(result.pv[0]).toEqual(firstMove);
  });

  it("TTのbestMoveが正しい防御手の場合、PVは継続する", () => {
    const board = createEmptyBoard();
    // 白の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    const tt = new TranspositionTable(1000);
    const hash = computeBoardHash(board);

    // 白がH8に打つ
    const firstMove = { row: 7, col: 7 };
    const boardAfterFirst = applyMove(board, firstMove, "white");
    const hash2 = computeBoardHash(boardAfterFirst);

    // 黒のTTエントリ: 活三の端を止める（正しい防御）
    tt.store(hash2, -100, 3, "EXACT", { row: 7, col: 3 });

    const result = extractPV(board, hash, firstMove, "white", tt);

    // 防御手は有効なのでPVは継続
    expect(result.pv.length).toBeGreaterThanOrEqual(2);
    expect(result.pv[1]).toEqual({ row: 7, col: 3 });
  });
});
