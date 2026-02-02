/**
 * Zobrist Hashingのテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { placeStonesOnBoard } from "./testUtils";
import { computeBoardHash, getZobristValue, updateHash } from "./zobrist";

describe("computeBoardHash", () => {
  it("空盤面のハッシュは0", () => {
    const board = createEmptyBoard();
    const hash = computeBoardHash(board);
    expect(hash).toBe(0n);
  });

  it("石がある盤面はゼロでないハッシュを返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const hash = computeBoardHash(board);
    expect(hash).not.toBe(0n);
  });

  it("異なる位置の石は異なるハッシュを生成する", () => {
    const board1 = createEmptyBoard();
    placeStonesOnBoard(board1, [{ row: 7, col: 7, color: "black" }]);

    const board2 = createEmptyBoard();
    placeStonesOnBoard(board2, [{ row: 7, col: 8, color: "black" }]);

    const hash1 = computeBoardHash(board1);
    const hash2 = computeBoardHash(board2);

    expect(hash1).not.toBe(hash2);
  });

  it("異なる色の石は異なるハッシュを生成する", () => {
    const board1 = createEmptyBoard();
    placeStonesOnBoard(board1, [{ row: 7, col: 7, color: "black" }]);

    const board2 = createEmptyBoard();
    placeStonesOnBoard(board2, [{ row: 7, col: 7, color: "white" }]);

    const hash1 = computeBoardHash(board1);
    const hash2 = computeBoardHash(board2);

    expect(hash1).not.toBe(hash2);
  });

  it("同じ盤面は同じハッシュを返す", () => {
    const board1 = createEmptyBoard();
    placeStonesOnBoard(board1, [
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);

    const board2 = createEmptyBoard();
    placeStonesOnBoard(board2, [
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);

    const hash1 = computeBoardHash(board1);
    const hash2 = computeBoardHash(board2);

    expect(hash1).toBe(hash2);
  });

  it("複数の石がある盤面のハッシュを計算できる", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
      { row: 6, col: 6, color: "black" },
      { row: 9, col: 9, color: "white" },
    ]);

    const hash = computeBoardHash(board);
    expect(typeof hash).toBe("bigint");
  });
});

describe("updateHash", () => {
  it("石を追加するとハッシュが変化する", () => {
    const initialHash = 0n;
    const newHash = updateHash(initialHash, 7, 7, "black");
    expect(newHash).not.toBe(initialHash);
  });

  it("XOR演算による差分更新の可逆性", () => {
    const initialHash = 0n;

    // 石を追加
    const hashWithStone = updateHash(initialHash, 7, 7, "black");
    expect(hashWithStone).not.toBe(initialHash);

    // 同じ石を再度XORすると元に戻る（取り除く操作と同等）
    const hashAfterRemove = updateHash(hashWithStone, 7, 7, "black");
    expect(hashAfterRemove).toBe(initialHash);
  });

  it("異なる位置への更新は異なるハッシュを生成する", () => {
    const initialHash = 0n;
    const hash1 = updateHash(initialHash, 7, 7, "black");
    const hash2 = updateHash(initialHash, 8, 8, "black");

    expect(hash1).not.toBe(hash2);
  });

  it("異なる色の更新は異なるハッシュを生成する", () => {
    const initialHash = 0n;
    const hashBlack = updateHash(initialHash, 7, 7, "black");
    const hashWhite = updateHash(initialHash, 7, 7, "white");

    expect(hashBlack).not.toBe(hashWhite);
  });

  it("computeBoardHashとupdateHashは一貫性がある", () => {
    // 空盤面から始めてupdateHashで石を追加
    let hash = 0n;
    hash = updateHash(hash, 7, 7, "black");
    hash = updateHash(hash, 8, 8, "white");

    // 同じ盤面をcomputeBoardHashで計算
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);
    const computedHash = computeBoardHash(board);

    expect(hash).toBe(computedHash);
  });

  it("石の追加順序に関係なく同じハッシュになる", () => {
    // 順序1: 黒→白
    let hash1 = 0n;
    hash1 = updateHash(hash1, 7, 7, "black");
    hash1 = updateHash(hash1, 8, 8, "white");

    // 順序2: 白→黒
    let hash2 = 0n;
    hash2 = updateHash(hash2, 8, 8, "white");
    hash2 = updateHash(hash2, 7, 7, "black");

    expect(hash1).toBe(hash2);
  });
});

describe("getZobristValue", () => {
  it("同じ位置・色には同じ値を返す", () => {
    const value1 = getZobristValue(7, 7, "black");
    const value2 = getZobristValue(7, 7, "black");

    expect(value1).toBe(value2);
  });

  it("異なる位置には異なる値を返す", () => {
    const value1 = getZobristValue(7, 7, "black");
    const value2 = getZobristValue(7, 8, "black");

    expect(value1).not.toBe(value2);
  });

  it("異なる色には異なる値を返す", () => {
    const valueBlack = getZobristValue(7, 7, "black");
    const valueWhite = getZobristValue(7, 7, "white");

    expect(valueBlack).not.toBe(valueWhite);
  });

  it("すべての位置で値を取得できる", () => {
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 15; col++) {
        const blackValue = getZobristValue(row, col, "black");
        const whiteValue = getZobristValue(row, col, "white");

        expect(typeof blackValue).toBe("bigint");
        expect(typeof whiteValue).toBe("bigint");
      }
    }
  });
});

describe("ハッシュ一意性", () => {
  it("ランダムな盤面で衝突が起きにくい", () => {
    const hashes = new Set<bigint>();
    const numTests = 100;

    for (let i = 0; i < numTests; i++) {
      const board = createEmptyBoard();
      // ランダムな位置に石を配置
      const numStones = Math.floor(Math.random() * 10) + 1;
      const stones: { row: number; col: number; color: "black" | "white" }[] =
        [];

      for (let j = 0; j < numStones; j++) {
        const row = Math.floor(Math.random() * 15);
        const col = Math.floor(Math.random() * 15);
        const color = j % 2 === 0 ? "black" : "white";

        if (board[row]?.[col] === null) {
          stones.push({ row, col, color });
          const boardRow = board[row];
          if (boardRow) {
            boardRow[col] = color;
          }
        }
      }

      const hash = computeBoardHash(board);
      hashes.add(hash);
    }

    // ほぼすべてのハッシュがユニークであることを確認
    // （完全なユニーク性は保証できないが、衝突は稀であるべき）
    expect(hashes.size).toBeGreaterThan(numTests * 0.9);
  });
});
