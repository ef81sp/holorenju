/**
 * Transposition Table（置換表）のテスト
 */

import { describe, expect, it, beforeEach } from "vitest";

import { TranspositionTable, type ScoreType } from "./transpositionTable";

describe("TranspositionTable", () => {
  let tt: TranspositionTable = new TranspositionTable(100);

  beforeEach(() => {
    tt = new TranspositionTable(100);
  });

  describe("store/probe", () => {
    it("保存と取得の基本動作", () => {
      const hash = 12345n;
      const score = 100;
      const depth = 3;
      const type: ScoreType = "EXACT";
      const bestMove = { row: 7, col: 7 };

      tt.store(hash, score, depth, type, bestMove);
      const entry = tt.probe(hash);

      expect(entry).not.toBe(null);
      expect(entry?.hash).toBe(hash);
      expect(entry?.score).toBe(score);
      expect(entry?.depth).toBe(depth);
      expect(entry?.type).toBe(type);
      expect(entry?.bestMove).toEqual(bestMove);
    });

    it("存在しないハッシュはnullを返す", () => {
      const entry = tt.probe(99999n);
      expect(entry).toBe(null);
    });

    it("bestMoveがnullの場合も正しく保存・取得できる", () => {
      const hash = 11111n;
      tt.store(hash, 50, 2, "LOWER_BOUND", null);
      const entry = tt.probe(hash);

      expect(entry?.bestMove).toBe(null);
    });

    it("LOWER_BOUNDタイプを正しく保存できる", () => {
      const hash = 22222n;
      tt.store(hash, 200, 4, "LOWER_BOUND", null);
      const entry = tt.probe(hash);

      expect(entry?.type).toBe("LOWER_BOUND");
    });

    it("UPPER_BOUNDタイプを正しく保存できる", () => {
      const hash = 33333n;
      tt.store(hash, -100, 4, "UPPER_BOUND", null);
      const entry = tt.probe(hash);

      expect(entry?.type).toBe("UPPER_BOUND");
    });
  });

  describe("置換戦略", () => {
    it("深度が深いエントリで置換される", () => {
      const hash = 100n;
      tt.store(hash, 50, 2, "EXACT", null);
      tt.store(hash, 100, 4, "EXACT", null);

      const entry = tt.probe(hash);
      expect(entry?.depth).toBe(4);
      expect(entry?.score).toBe(100);
    });

    it("深度が浅いエントリでは置換されない", () => {
      const hash = 200n;
      tt.store(hash, 100, 4, "EXACT", null);
      tt.store(hash, 50, 2, "LOWER_BOUND", null);

      const entry = tt.probe(hash);
      expect(entry?.depth).toBe(4);
      expect(entry?.score).toBe(100);
    });

    it("EXACTタイプは同じ深度でも置換される", () => {
      const hash = 300n;
      tt.store(hash, 50, 3, "LOWER_BOUND", null);
      tt.store(hash, 100, 3, "EXACT", null);

      const entry = tt.probe(hash);
      expect(entry?.type).toBe("EXACT");
      expect(entry?.score).toBe(100);
    });

    it("古い世代のエントリは置換される（2世代以上前）", () => {
      const hash = 400n;
      tt.store(hash, 50, 5, "EXACT", null);
      tt.newGeneration();
      tt.newGeneration(); // 2世代以上前になるよう2回進める
      tt.store(hash, 100, 2, "LOWER_BOUND", null);

      const entry = tt.probe(hash);
      expect(entry?.depth).toBe(2);
      expect(entry?.score).toBe(100);
    });
  });

  describe("世代管理", () => {
    it("newGeneration()で世代が進む", () => {
      const stats1 = tt.getStats();
      tt.newGeneration();
      const stats2 = tt.getStats();

      expect(stats2.generation).toBe(stats1.generation + 1);
    });

    it("新しい世代のエントリは現在の世代を持つ", () => {
      tt.newGeneration();
      tt.newGeneration();
      const hash = 500n;
      tt.store(hash, 100, 3, "EXACT", null);

      const entry = tt.probe(hash);
      expect(entry?.generation).toBe(2);
    });
  });

  describe("eviction（エントリ削除）", () => {
    it("maxSize超過時に古いエントリが削除される", () => {
      const smallTT = new TranspositionTable(10);

      // 10個のエントリを追加
      for (let i = 0; i < 10; i++) {
        smallTT.store(BigInt(i), i, 1, "EXACT", null);
      }
      expect(smallTT.size).toBe(10);

      // 11個目を追加すると削除が発生
      smallTT.store(11n, 100, 1, "EXACT", null);
      expect(smallTT.size).toBeLessThanOrEqual(10);
    });

    it("古い世代のエントリが優先的に削除される", () => {
      const smallTT = new TranspositionTable(10);

      // 最初の世代で5個追加
      for (let i = 0; i < 5; i++) {
        smallTT.store(BigInt(i), i, 1, "EXACT", null);
      }

      // 新しい世代で5個追加
      smallTT.newGeneration();
      for (let i = 5; i < 10; i++) {
        smallTT.store(BigInt(i), i, 1, "EXACT", null);
      }

      // さらに追加してevictionを発生させる
      smallTT.store(100n, 100, 1, "EXACT", null);

      // 新しい世代のエントリは残っている可能性が高い
      const newGenEntry = smallTT.probe(9n);
      expect(newGenEntry).not.toBe(null);
    });
  });

  describe("clear", () => {
    it("テーブルをクリアするとサイズが0になる", () => {
      tt.store(1n, 100, 3, "EXACT", null);
      tt.store(2n, 200, 3, "EXACT", null);
      expect(tt.size).toBe(2);

      tt.clear();
      expect(tt.size).toBe(0);
    });

    it("クリア後は以前のエントリを取得できない", () => {
      const hash = 123n;
      tt.store(hash, 100, 3, "EXACT", null);
      tt.clear();

      const entry = tt.probe(hash);
      expect(entry).toBe(null);
    });

    it("クリア後は世代が0にリセットされる", () => {
      tt.newGeneration();
      tt.newGeneration();
      tt.clear();

      const stats = tt.getStats();
      expect(stats.generation).toBe(0);
    });
  });

  describe("getStats", () => {
    it("統計情報を正しく返す", () => {
      tt.store(1n, 100, 3, "EXACT", null);
      tt.store(2n, 200, 3, "EXACT", null);
      tt.newGeneration();

      const stats = tt.getStats();
      expect(stats.size).toBe(2);
      expect(stats.generation).toBe(1);
      expect(stats.maxSize).toBe(100);
    });
  });

  describe("size", () => {
    it("エントリ数を正しく返す", () => {
      expect(tt.size).toBe(0);

      tt.store(1n, 100, 3, "EXACT", null);
      expect(tt.size).toBe(1);

      tt.store(2n, 200, 3, "EXACT", null);
      expect(tt.size).toBe(2);

      // 同じハッシュは置換されるのでサイズは増えない
      tt.store(1n, 150, 4, "EXACT", null);
      expect(tt.size).toBe(2);
    });
  });
});
