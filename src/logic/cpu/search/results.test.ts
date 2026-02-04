/**
 * 探索結果の型定義とPV抽出のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { placeStonesOnBoard } from "../testUtils";
import { TranspositionTable } from "../transpositionTable";
import { computeBoardHash } from "../zobrist";
import { extractPV } from "./results";

describe("extractPV", () => {
  it("TTにエントリがない場合は最初の手のみ", () => {
    const board = createEmptyBoard();
    const tt = new TranspositionTable(1000);
    const hash = computeBoardHash(board);
    const firstMove = { row: 7, col: 7 };

    const result = extractPV(board, hash, firstMove, "black", tt);

    expect(result.pv).toHaveLength(1);
    expect(result.pv[0]).toEqual(firstMove);
    expect(result.leafBoard[7]?.[7]).toBe("black");
    expect(result.leafColor).toBe("white");
  });

  it("TTエントリを辿ってPVを復元", () => {
    const board = createEmptyBoard();
    const tt = new TranspositionTable(1000);

    // 最初の手: (7,7)に黒
    const firstMove = { row: 7, col: 7 };
    const hash1 = computeBoardHash(board);

    // 2手目のTTエントリを設定: (7,8)に白
    const board1 = createEmptyBoard();
    placeStonesOnBoard(board1, [{ row: 7, col: 7, color: "black" }]);
    const hash2 = computeBoardHash(board1);
    tt.store(hash2, 5, 100, "EXACT", { row: 7, col: 8 });

    // 3手目のTTエントリを設定: (7,6)に黒
    const board2 = createEmptyBoard();
    placeStonesOnBoard(board2, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);
    const hash3 = computeBoardHash(board2);
    tt.store(hash3, 4, 50, "EXACT", { row: 7, col: 6 });

    const result = extractPV(board, hash1, firstMove, "black", tt);

    expect(result.pv).toHaveLength(3);
    expect(result.pv[0]).toEqual({ row: 7, col: 7 });
    expect(result.pv[1]).toEqual({ row: 7, col: 8 });
    expect(result.pv[2]).toEqual({ row: 7, col: 6 });
  });

  it("既に石がある位置で終了", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 8, color: "white" }]);

    const tt = new TranspositionTable(1000);
    const hash = computeBoardHash(board);
    const firstMove = { row: 7, col: 7 };

    // 次の手として既に石がある位置を指すTTエントリ
    const board1 = createEmptyBoard();
    placeStonesOnBoard(board1, [
      { row: 7, col: 8, color: "white" },
      { row: 7, col: 7, color: "black" },
    ]);
    const hash2 = computeBoardHash(board1);
    tt.store(hash2, 5, 100, "EXACT", { row: 7, col: 8 }); // 既に石がある

    const result = extractPV(board, hash, firstMove, "black", tt);

    // 石がある位置で打ち切り
    expect(result.pv).toHaveLength(1);
  });

  it("maxLengthで制限", () => {
    const _board = createEmptyBoard();
    const tt = new TranspositionTable(1000);

    // 多くのTTエントリを設定
    let currentBoard = createEmptyBoard();
    for (let i = 0; i < 20; i++) {
      const hash = computeBoardHash(currentBoard);
      const move = { row: 7, col: i };
      tt.store(hash, 10, 100, "EXACT", move);
      placeStonesOnBoard(currentBoard, [
        { row: 7, col: i, color: i % 2 === 0 ? "black" : "white" },
      ]);
    }

    const firstMove = { row: 7, col: 0 };
    const result = extractPV(
      createEmptyBoard(),
      computeBoardHash(createEmptyBoard()),
      firstMove,
      "black",
      tt,
      5, // maxLength
    );

    expect(result.pv.length).toBeLessThanOrEqual(5);
  });

  it("色が交互に切り替わる", () => {
    const board = createEmptyBoard();
    const tt = new TranspositionTable(1000);
    const hash = computeBoardHash(board);
    const firstMove = { row: 7, col: 7 };

    const result = extractPV(board, hash, firstMove, "black", tt);

    // 最初が黒、次は白
    expect(result.leafBoard[7]?.[7]).toBe("black");
    expect(result.leafColor).toBe("white");
  });
});
