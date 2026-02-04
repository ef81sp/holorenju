/**
 * 探索テクニックのテスト
 *
 * LMR（Late Move Reductions）、タクティカルムーブ、防御テスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { DEFAULT_EVAL_OPTIONS, PATTERN_SCORES } from "../evaluation";
import { placeStonesOnBoard } from "../testUtils";
import { findBestMoveIterativeWithTT } from "./minimax";

describe("LMR タクティカルムーブ除外", () => {
  it("四を作る手が正しく検出される", () => {
    const board = createEmptyBoard();
    // 黒が3つ並んでいる状態（四を作れる）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 四を作る手(7,3)か(7,7)が最善手として選ばれるはず
    // LMRでスキップされずに正しく評価される
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      5,
      5000,
      0,
      DEFAULT_EVAL_OPTIONS,
    );

    // 四を作る手が選ばれる
    expect(result.position.row).toBe(7);
    expect([3, 7]).toContain(result.position.col);
  });

  it("複数の四がある局面で正しく最善手を選ぶ", () => {
    const board = createEmptyBoard();
    // 黒が複数方向に四を作れる状態
    // 横方向: 3つ並び（7,4）（7,5）（7,6）→ (7,3)または(7,7)で四
    // 縦方向: 3つ並び（4,7）（5,7）（6,7）→ (3,7)または(7,7)で四
    placeStonesOnBoard(board, [
      // 横方向の三
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      // 縦方向の三
      { row: 4, col: 7, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    // 複数の四を作れる手がある中で、最善手が選ばれる
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      5,
      5000,
      0,
      DEFAULT_EVAL_OPTIONS,
    );

    // 有効な手が選ばれる
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);

    // この局面では、CPUはVCF（四追い勝ち）を発見する
    // (3,7)で四を作り、(2,7)で勝利確定
    // そのため、最善手は (2,7)（VCFの開始手）や (3,7)（直接の四）など
    // 高スコア（勝利確定相当）が返されることを確認
    expect(result.score).toBeGreaterThanOrEqual(PATTERN_SCORES.FIVE);
  });

  it("跳び四を作る手もLMRから除外される", () => {
    const board = createEmptyBoard();
    // 跳び四パターン（●●●・●）を作れる状態
    // (7,4), (7,5), (7,6) に黒、(7,8) に打つと跳び四
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      // (7,7) は空けておく
    ]);

    // 跳び四を作れる手が正しく評価される
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      5,
      5000,
      0,
      DEFAULT_EVAL_OPTIONS,
    );

    // 有効な手が選ばれる（通常は連続四の方が優先されるが、跳び四も考慮される）
    expect(result.position.row).toBe(7);
    // 連続四: (7,3) または (7,7)
    // 跳び四: (7,8) で ●●●・●
    expect([3, 7, 8]).toContain(result.position.col);
  });
});

describe("活三防御", () => {
  it("白は黒の横活三を止める", async () => {
    // 白にVCFがない盤面で、黒の活三を止めることをテスト
    const board = createEmptyBoard();
    // 黒石: 横に3つ並んでいる（活三）- 両端が空いている
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";
    // 白石: 1つだけ（VCFを作れない）
    board[5][5] = "white";

    // デバッグ: 候補手を確認
    const { generateSortedMoves } = await import("../moveGenerator");
    const { detectOpponentThreats } = await import("../evaluation");
    const { findVCFMove } = await import("./vcf");

    // 白にVCFがないことを確認
    const vcfMove = findVCFMove(board, "white");
    console.log("白のVCF:", vcfMove);

    const moves = generateSortedMoves(board, "white", {
      ttMove: null,
      useStaticEval: true,
      evaluationOptions: DEFAULT_EVAL_OPTIONS,
    });
    console.log("候補手数:", moves.length);

    const threats = detectOpponentThreats(board, "black");
    console.log("活三の防御位置:", threats.openThrees);

    // VCFがあっても活三防御位置に打つべき場合がある
    // （VCFより活三防御が優先される場合）
    // ただし、VCFがあれば VCF を打つのが正しい動作
    // このテストでは活三防御が機能することを確認する
    const result = findBestMoveIterativeWithTT(
      board,
      "white",
      3,
      5000,
      0,
      DEFAULT_EVAL_OPTIONS,
    );

    console.log("白の選択:", result.position);

    // 白の選択が活三防御位置(7,5)か(7,9)、またはVCFの手であること
    // VCFがあればVCFを優先するのが正しい
    if (vcfMove) {
      // VCFがあればVCFの手を選ぶべき
      expect(result.position).toEqual(vcfMove);
    } else {
      // VCFがなければ活三を止めるべき
      const isDefending =
        (result.position.row === 7 && result.position.col === 5) ||
        (result.position.row === 7 && result.position.col === 9);
      expect(isDefending).toBe(true);
    }
  });
});
