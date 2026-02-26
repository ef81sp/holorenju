/**
 * 探索結果の型定義とPV抽出のテスト
 */

import { describe, expect, it } from "vitest";

import type { BoardState, Position } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

import { applyMove, getOppositeColor } from "../core/boardUtils";
import { placeStonesOnBoard } from "../testUtils";
import { TranspositionTable } from "../transpositionTable";
import { computeBoardHash } from "../zobrist";
import {
  extractPV,
  type PVExtractionResult,
  truncateUnproductiveFours,
} from "./results";

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

describe("truncateUnproductiveFours", () => {
  /** PVExtractionResult をPV手順から構築するヘルパー */
  function buildPVResult(
    board: BoardState,
    pv: Position[],
    startColor: "black" | "white",
  ): PVExtractionResult {
    let currentBoard = board;
    let currentColor = startColor;
    for (const move of pv) {
      currentBoard = applyMove(currentBoard, move, currentColor);
      currentColor = getOppositeColor(currentColor);
    }
    return { pv, leafBoard: currentBoard, leafColor: currentColor };
  }

  it("PVに非生産的四伸びなし → 切り詰めなし", () => {
    const board = createEmptyBoard();
    const pv: Position[] = [
      { row: 7, col: 7 },
      { row: 7, col: 8 },
      { row: 8, col: 7 },
    ];
    const pvResult = buildPVResult(board, pv, "black");
    const result = truncateUnproductiveFours(pvResult, board, "black");

    expect(result.pv).toHaveLength(3);
    expect(result.pv).toEqual(pv);
  });

  it("PV末尾に1ペアの非生産的四伸び → 切り詰め", () => {
    const board = createEmptyBoard();
    // 横方向に黒3つ → (7,7) で四
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const pv: Position[] = [
      { row: 8, col: 8 }, // black: 通常手
      { row: 9, col: 9 }, // white: 通常手
      { row: 7, col: 7 }, // black: 非生産的四（横4連、活三なし）
      { row: 7, col: 3 }, // white: ブロック
    ];

    const pvResult = buildPVResult(board, pv, "black");
    const result = truncateUnproductiveFours(pvResult, board, "black");

    expect(result.pv).toHaveLength(2);
    expect(result.pv[0]).toEqual({ row: 8, col: 8 });
    expect(result.pv[1]).toEqual({ row: 9, col: 9 });
    // leafBoard は最初の2手適用後
    expect(result.leafBoard[8]?.[8]).toBe("black");
    expect(result.leafBoard[9]?.[9]).toBe("white");
    expect(result.leafColor).toBe("black");
  });

  it("PV末尾に2ペア以上の連鎖 → 連鎖全体を切り詰め", () => {
    const board = createEmptyBoard();
    // 横方向に黒3つ + 縦方向に黒3つ（別の場所）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 4, col: 10, color: "black" },
      { row: 5, col: 10, color: "black" },
      { row: 6, col: 10, color: "black" },
    ]);

    const pv: Position[] = [
      { row: 8, col: 8 }, // black: 通常手
      { row: 9, col: 9 }, // white: 通常手
      { row: 7, col: 7 }, // black: 横方向の非生産的四
      { row: 7, col: 3 }, // white: ブロック
      { row: 7, col: 10 }, // black: 縦方向の非生産的四
      { row: 3, col: 10 }, // white: ブロック
    ];

    const pvResult = buildPVResult(board, pv, "black");
    const result = truncateUnproductiveFours(pvResult, board, "black");

    expect(result.pv).toHaveLength(2);
    expect(result.pv[0]).toEqual({ row: 8, col: 8 });
    expect(result.pv[1]).toEqual({ row: 9, col: 9 });
  });

  it("四三に繋がる四 → 切り詰めなし", () => {
    const board = createEmptyBoard();
    // (7,7) に置くと横四＋縦活三 = 四三
    placeStonesOnBoard(board, [
      // 横方向: 3つ → (7,7) で四
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      // 縦方向: 2つ → (7,7) で活三（両端空き）
      { row: 6, col: 7, color: "black" },
      { row: 5, col: 7, color: "black" },
    ]);

    const pv: Position[] = [
      { row: 8, col: 8 }, // black: 通常手
      { row: 9, col: 9 }, // white: 通常手
      { row: 7, col: 7 }, // black: 四三（生産的）
      { row: 7, col: 3 }, // white: ブロック
    ];

    const pvResult = buildPVResult(board, pv, "black");
    const result = truncateUnproductiveFours(pvResult, board, "black");

    expect(result.pv).toHaveLength(4); // 切り詰めなし
  });

  it("中間に非生産的四、末尾に生産的手 → 切り詰めなし", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const pv: Position[] = [
      { row: 7, col: 7 }, // black: 非生産的四（中間）
      { row: 7, col: 3 }, // white: ブロック
      { row: 8, col: 8 }, // black: 通常手（末尾）
    ];

    const pvResult = buildPVResult(board, pv, "black");
    const result = truncateUnproductiveFours(pvResult, board, "black");

    expect(result.pv).toHaveLength(3); // 中間は除去しない
  });
});
