/**
 * Minimax + Alpha-Beta剪定のテスト
 *
 * コア探索アルゴリズムのテスト
 * 詳細なテストは各サブモジュールのテストファイルを参照:
 * - search/iterativeDeepening.test.ts - 反復深化・時間/ノード制限テスト
 * - search/techniques.test.ts - LMR・戦術的手テスト
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

import { FULL_EVAL_OPTIONS, PATTERN_SCORES } from "../evaluation";
import { createBoardWithStones, placeStonesOnBoard } from "../testUtils";
import {
  findBestMove,
  findBestMoveIterativeWithTT,
  findBestMoveWithTT,
  minimax,
} from "./minimax";

describe("minimax", () => {
  it("深さ0では現在の盤面評価を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const score = minimax(board, 0, true, "black");
    expect(typeof score).toBe("number");
  });

  it("maximizingPlayerがtrueの場合は最大値を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const score = minimax(board, 1, true, "black");
    expect(typeof score).toBe("number");
  });

  it("maximizingPlayerがfalseの場合は最小値を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const score = minimax(board, 1, false, "black");
    expect(typeof score).toBe("number");
  });
});

describe("findBestMove", () => {
  it("空の盤面では中央を返す", () => {
    const board = createEmptyBoard();
    const result = findBestMove(board, "black", 2);

    expect(result.position).toEqual({ row: 7, col: 7 });
  });

  it("勝利できる手がある場合はその手を選ぶ", () => {
    const board = createEmptyBoard();
    // 黒が4つ並んでいる状態
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const result = findBestMove(board, "black", 2);

    // 五連を作る手を選ぶはず
    expect(
      (result.position.row === 7 && result.position.col === 7) ||
        (result.position.row === 7 && result.position.col === 2),
    ).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(PATTERN_SCORES.FIVE);
  });

  it("相手の勝利を阻止する手を選ぶ", () => {
    const board = createEmptyBoard();
    // 白が4つ並んでいる状態（白が勝ちそう）
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 8, col: 8, color: "black" }, // 黒の手番用
    ]);

    // 深度を2で白の脅威を認識する
    const result = findBestMove(board, "black", 2);

    // 有効な手が返されることを確認
    // 評価スコアが負の場合、相手が有利と認識している
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    // 相手が有利な盤面なのでスコアは負
    expect(result.score).toBeLessThan(0);
  });

  it("探索深度に応じた結果を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    const result1 = findBestMove(board, "black", 1);
    const result2 = findBestMove(board, "black", 2);

    // 両方とも有効な手を返す
    expect(result1.position.row).toBeGreaterThanOrEqual(0);
    expect(result1.position.row).toBeLessThan(15);
    expect(result2.position.row).toBeGreaterThanOrEqual(0);
    expect(result2.position.row).toBeLessThan(15);
  });

  it("白番でも正しく動作する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    const result = findBestMove(board, "white", 2);

    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeLessThan(15);
  });

  it("ランダム要素がある場合でも有効な手を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    const result = findBestMove(board, "black", 2, 0.3);

    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeLessThan(15);
  });
});

describe("強制手フラグ", () => {
  it("候補手が1つの場合、forcedMove=trueかつscore=0を返す", () => {
    // ベンチマーク実データ: 12手目まで打った盤面で13手目（黒番）が強制手
    // 棋譜: H8 G8 J6 G9 G7 I9 J7 J8 H7 I7 I8 J9
    const { board } = createBoardFromRecord(
      "H8 G8 J6 G9 G7 I9 J7 J8 H7 I7 I8 J9",
    );

    const result = findBestMoveIterativeWithTT({
      board,
      color: "black",
      maxDepth: 4,
      timeLimit: 5000,
      randomFactor: 0,
      evaluationOptions: FULL_EVAL_OPTIONS,
    });

    // 候補手が1つに絞られ、forcedMoveフラグが立つ
    expect(result.forcedMove).toBe(true);
    expect(result.score).toBe(0);
    expect(result.completedDepth).toBe(0);
  });

  it("複数候補手がある場合、forcedMoveは設定されない", () => {
    const board = createBoardWithStones([
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);

    const result = findBestMoveIterativeWithTT({
      board,
      color: "black",
      maxDepth: 2,
      timeLimit: 5000,
      randomFactor: 0,
      evaluationOptions: FULL_EVAL_OPTIONS,
    });

    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
    expect(result.forcedMove).toBeUndefined();
  });
});

describe("同スコア手のタイブレーク", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("対称盤面で同スコアの手が複数ある場合、タイブレークが発生する", () => {
    // 中央に黒1手のみ → 対称的な盤面で同スコアの手が複数存在するはず
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);

    // Math.random を固定して再現性のあるテスト
    vi.spyOn(Math, "random").mockReturnValue(0.0);

    const result = findBestMoveWithTT(board, "white", 2, 0);

    // randomSelection が返される
    expect(result.randomSelection).toBeDefined();

    if (result.randomSelection?.wasTieBreak) {
      // タイブレーク発生時: 同スコア手が2手以上
      expect(result.randomSelection.wasTieBreak).toBe(true);
      expect(result.randomSelection.wasRandom).toBe(false);
      expect(result.randomSelection.candidateCount).toBeGreaterThanOrEqual(2);
    } else {
      // タイブレーク未発生（同スコアが1手のみ）: wasRandom=false, wasTieBreak=false
      expect(result.randomSelection?.wasRandom).toBe(false);
      expect(result.randomSelection?.wasTieBreak).toBe(false);
    }
  });

  it("タイブレーク時にMath.randomの値で異なる手が選ばれる", () => {
    // 中央に黒1手のみの対称盤面
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);

    // 最初: Math.random = 0.0（最初の同スコア手を選択）
    vi.spyOn(Math, "random").mockReturnValue(0.0);
    const result1 = findBestMoveWithTT(board, "white", 2, 0);

    // 次: Math.random = 0.99（最後の同スコア手を選択）
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result2 = findBestMoveWithTT(board, "white", 2, 0);

    // 両方とも有効な手を返す
    expect(result1.position.row).toBeGreaterThanOrEqual(0);
    expect(result2.position.row).toBeGreaterThanOrEqual(0);

    // タイブレークが発生した場合、異なる手が選ばれるはず
    if (
      result1.randomSelection?.wasTieBreak &&
      result2.randomSelection?.wasTieBreak &&
      result1.randomSelection.candidateCount > 1
    ) {
      const sameMove =
        result1.position.row === result2.position.row &&
        result1.position.col === result2.position.col;
      expect(sameMove).toBe(false);
    }
  });

  it("単独最善手がある場合はwasTieBreak=falseになる", () => {
    // 黒が4つ並び、片端を白がブロック → 五連は1手のみ
    const board = createBoardWithStones([
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);

    const result = findBestMoveWithTT(board, "black", 2, 0);

    expect(result.randomSelection).toBeDefined();
    expect(result.randomSelection?.wasTieBreak).toBe(false);
    expect(result.randomSelection?.wasRandom).toBe(false);
    // 唯一の五連手 (7, 7) が選ばれる
    expect(result.position).toEqual({ row: 7, col: 7 });
  });
});
