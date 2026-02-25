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
import {
  calculateDynamicTimeLimit,
  hasImmediateThreat,
  isTacticalMove,
} from "./techniques";

describe("LMR と四を作る手", () => {
  it("四を作る手もLMR対象だが、最善手として正しく選ばれる", () => {
    const board = createEmptyBoard();
    // 黒が3つ並んでいる状態（四を作れる）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 四を作る手はLMR対象だが、move orderingで上位に来るため
    // LMR_MOVE_THRESHOLD未満で探索され、正しく評価される
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

  it("VCFがある局面で正しく勝ちを見つける", () => {
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

    // VCFがある局面では pre-search で検出されるため、
    // LMR の四免除がなくても勝ちを見つける
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      5,
      5000,
      0,
      DEFAULT_EVAL_OPTIONS,
    );

    expect(result.score).toBeGreaterThanOrEqual(PATTERN_SCORES.FIVE);
  });

  it("四を作る手がmove orderingで上位に来るため正しく評価される", () => {
    const board = createEmptyBoard();
    // 跳び四パターン（●●●・●）を作れる状態
    // (7,4), (7,5), (7,6) に黒、(7,8) に打つと跳び四
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 四を作る手はmove orderingで高スコアになるため、
    // LMR_MOVE_THRESHOLD より前に探索されフル深度で読まれる
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      5,
      5000,
      0,
      DEFAULT_EVAL_OPTIONS,
    );

    expect(result.position.row).toBe(7);
    expect([3, 7, 8]).toContain(result.position.col);
  });
});

describe("isTacticalMove", () => {
  it("五連完成手を戦術手と判定する", () => {
    const board = createEmptyBoard();
    // 白が4つ並んでいる状態で、5つ目を置いて五連完成
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    // (7,8) に置くと五連完成
    expect(isTacticalMove(board, { row: 7, col: 8 }, "white")).toBe(true);
    // (7,3) に置いても五連完成
    expect(isTacticalMove(board, { row: 7, col: 3 }, "white")).toBe(true);
  });

  it("四を作る手を戦術手と判定する", () => {
    const board = createEmptyBoard();
    // 黒が3つ並んでいる状態で、4つ目を置いて四を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // (7,4) に置くと四を作る（両端空き）
    expect(isTacticalMove(board, { row: 7, col: 4 }, "black")).toBe(true);
    // (7,8) に置いても四を作る
    expect(isTacticalMove(board, { row: 7, col: 8 }, "black")).toBe(true);
  });

  it("三を作る手は戦術手ではない", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);
    // (7,7) に置くと三を作るが、四ではない
    expect(isTacticalMove(board, { row: 7, col: 7 }, "black")).toBe(false);
  });
});

describe("hasImmediateThreat", () => {
  it("相手に四がある場合 true を返す", () => {
    const board = createEmptyBoard();
    // 白が4つ並んでいる（片端開き = 四）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    expect(hasImmediateThreat(board, "white")).toBe(true);
  });

  it("相手に四がない場合 false を返す", () => {
    const board = createEmptyBoard();
    // 白が3つだけ（活三だが四ではない）
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    expect(hasImmediateThreat(board, "white")).toBe(false);
  });

  it("両端が塞がれた4連は脅威ではない", () => {
    const board = createEmptyBoard();
    // 白4連だが両端が黒で塞がれている
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 7, col: 8, color: "black" },
    ]);
    expect(hasImmediateThreat(board, "white")).toBe(false);
  });

  it("空盤では脅威なし", () => {
    const board = createEmptyBoard();
    expect(hasImmediateThreat(board, "black")).toBe(false);
    expect(hasImmediateThreat(board, "white")).toBe(false);
  });

  it("縦方向の四も検出する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 4, col: 7, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(hasImmediateThreat(board, "black")).toBe(true);
  });

  it("斜め方向の四も検出する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 4, col: 4, color: "white" },
      { row: 5, col: 5, color: "white" },
      { row: 6, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    expect(hasImmediateThreat(board, "white")).toBe(true);
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

describe("calculateDynamicTimeLimit", () => {
  it("唯一の候補手（moveCount <= 1）→ 0 を返す", () => {
    const board = createEmptyBoard();
    expect(calculateDynamicTimeLimit(5000, board, 1)).toBe(0);
    expect(calculateDynamicTimeLimit(5000, board, 0)).toBe(0);
  });

  it("序盤（stones <= 6）→ baseTimeLimit * 0.7", () => {
    const board = createEmptyBoard();
    // 6手配置（stones = 6）
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
      { row: 8, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
      { row: 6, col: 7, color: "black" },
      { row: 6, col: 8, color: "white" },
    ]);
    expect(calculateDynamicTimeLimit(5000, board, 10)).toBe(
      Math.floor(5000 * 0.7),
    );
  });

  it("候補手が少ない（moveCount <= 3）→ baseTimeLimit * 0.3", () => {
    const board = createEmptyBoard();
    // 7手以上で序盤を抜ける
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
      { row: 8, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
      { row: 6, col: 7, color: "black" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 7, color: "black" },
    ]);
    expect(calculateDynamicTimeLimit(5000, board, 3)).toBe(
      Math.floor(5000 * 0.3),
    );
    expect(calculateDynamicTimeLimit(5000, board, 2)).toBe(
      Math.floor(5000 * 0.3),
    );
  });

  it("通常ケース → baseTimeLimit をそのまま返す", () => {
    const board = createEmptyBoard();
    // 7手以上で序盤を抜ける
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
      { row: 8, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
      { row: 6, col: 7, color: "black" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 7, color: "black" },
    ]);
    expect(calculateDynamicTimeLimit(5000, board, 10)).toBe(5000);
  });
});
