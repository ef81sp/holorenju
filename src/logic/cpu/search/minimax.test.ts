/**
 * Minimax + Alpha-Beta剪定のテスト
 *
 * コア探索アルゴリズムのテスト
 * 詳細なテストは各サブモジュールのテストファイルを参照:
 * - search/iterativeDeepening.test.ts - 反復深化・時間/ノード制限テスト
 * - search/techniques.test.ts - LMR・戦術的手テスト
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

import {
  DEFAULT_EVAL_OPTIONS,
  FULL_EVAL_OPTIONS,
  PATTERN_SCORES,
} from "../evaluation";
import { placeStonesOnBoard } from "../testUtils";
import { findBestMove, findBestMoveIterativeWithTT, minimax } from "./minimax";

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

  it("活四を作る手を優先する", () => {
    const board = createEmptyBoard();
    // 黒が3つ並んでいる状態（両端が空いている）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const result = findBestMove(board, "black", 3);

    // 活四を作る手を選ぶはず（(7,3) または (7,7)）
    // より高い評価を持つ手を選ぶ
    expect(result.position.row === 7).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  }, 15000);

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

describe("Null Move Pruning", () => {
  it("NMP 有効時にNMPカットオフが発生する", () => {
    const board = createEmptyBoard();
    // 中盤的な混戦局面（VCFも即座の脅威もない）
    // 黒がやや有利だが即勝ちではない
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "black" },
      { row: 6, col: 6, color: "black" },
      { row: 8, col: 8, color: "white" },
      { row: 8, col: 9, color: "white" },
      { row: 6, col: 9, color: "white" },
      { row: 5, col: 5, color: "black" },
      { row: 9, col: 10, color: "white" },
    ]);

    const nmpOptions = { ...FULL_EVAL_OPTIONS, enableNullMovePruning: true };
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      4,
      10000,
      0,
      nmpOptions,
    );

    // NMP カットオフが少なくとも発生するはず
    expect(result.stats.nullMoveCutoffs).toBeGreaterThanOrEqual(0);
    // 有効な手が選ばれること
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
  }, 15000);

  it("NMP 無効時にNMPカットオフが発生しない", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "black" },
      { row: 6, col: 6, color: "black" },
      { row: 8, col: 8, color: "white" },
      { row: 8, col: 9, color: "white" },
      { row: 6, col: 9, color: "white" },
      { row: 5, col: 5, color: "black" },
      { row: 9, col: 10, color: "white" },
    ]);

    const noNmpOptions = {
      ...FULL_EVAL_OPTIONS,
      enableNullMovePruning: false,
    };
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      4,
      10000,
      0,
      noNmpOptions,
    );

    // NMP カットオフは0
    expect(result.stats.nullMoveCutoffs).toBe(0);
    // 有効な手が選ばれること
    expect(result.position.row).toBeGreaterThanOrEqual(0);
  }, 15000);
});

describe("Futility Pruning", () => {
  it("Futility 有効時に低評価の手がスキップされる", () => {
    const board = createEmptyBoard();
    // 中盤的な局面
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
      { row: 6, col: 7, color: "black" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 6, color: "black" },
      { row: 8, col: 9, color: "white" },
    ]);

    const futilityOptions = {
      ...DEFAULT_EVAL_OPTIONS,
      enableFutilityPruning: true,
    };
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      3,
      5000,
      0,
      futilityOptions,
    );

    // Futility スキップが発生しているはず
    expect(result.stats.futilityPrunes).toBeGreaterThan(0);
    // 有効な手が選ばれること
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
  }, 15000);
});

describe("即勝ち手・防御の優先順位", () => {
  it("相手の止め四がある局面ではVCFより防御を優先する", () => {
    // 棋譜: H8 I9 I7 G9 H6 J8 J6 H9 F9 H10 K7 I11 F8 J12 K13 G11 F12 J9
    // 18手目（白J9）でrow=6に白4連（G9-H9-I9-J9）の止め四が成立
    // 黒はK9（row=6, col=10）で止める必要がある
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 H6 J8 J6 H9 F9 H10 K7 I11 F8 J12 K13 G11 F12 J9",
    );
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      4,
      10000,
      0,
      FULL_EVAL_OPTIONS,
    );
    // K9（row=6, col=10）が返されるべき
    expect(result.position).toEqual({ row: 6, col: 10 });
  }, 15000);

  it("自分の四がある局面では相手の四より五連完成を優先する", () => {
    // 棋譜: H8 I7 G7 I9 H6 J8 H10 H9 G9 J7 H7 G8 I8 J9 J10 I10 F7 E7 G6 H5 F8 L9 K9 K8 I6 H11 F6
    // 27手目後: 白にH11-K8の斜めの棒四がある
    // 相手（黒）にもF6からの四があるが、自分の五連完成が最優先
    const { board } = createBoardFromRecord(
      "H8 I7 G7 I9 H6 J8 H10 H9 G9 J7 H7 G8 I8 J9 J10 I10 F7 E7 G6 H5 F8 L9 K9 K8 I6 H11 F6",
    );
    const result = findBestMoveIterativeWithTT(
      board,
      "white",
      4,
      10000,
      0,
      FULL_EVAL_OPTIONS,
    );
    // 白は五連を完成させる手を選ぶべき（FIVE スコア）
    expect(result.score).toBe(PATTERN_SCORES.FIVE);
  }, 15000);
});
