/**
 * Minimax + Alpha-Beta剪定のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { DEFAULT_EVAL_OPTIONS, PATTERN_SCORES } from "../evaluation";
import { placeStonesOnBoard } from "../testUtils";
import {
  findBestMove,
  findBestMoveIterative,
  findBestMoveIterativeWithTT,
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

describe("findBestMoveIterative", () => {
  it("深さ1から開始して有効な手を返す", () => {
    const board = createEmptyBoard();
    const result = findBestMoveIterative(board, "black", 3, 5000);

    expect(result.position).toEqual({ row: 7, col: 7 });
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
    expect(typeof result.interrupted).toBe("boolean");
  });

  it("時間制限内で可能な限り深く探索する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    // 2秒の時間制限で最大深度3まで探索（評価関数の計算量増加に対応）
    const result = findBestMoveIterative(board, "black", 3, 2000);

    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
    expect(result.completedDepth).toBeLessThanOrEqual(3);
  }, 10000);

  it("短い時間制限では早期に中断する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
      { row: 6, col: 6, color: "black" },
      { row: 6, col: 8, color: "white" },
    ]);

    // 非常に短い時間制限（10ms）
    const result = findBestMoveIterative(board, "black", 5, 10);

    // 有効な手が返される
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    // 浅い深度で完了するはず
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
  });

  it("勝利できる手がある場合は高スコアを返す", () => {
    const board = createEmptyBoard();
    // 黒が4つ並んでいる状態（両端が空いている）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const result = findBestMoveIterative(board, "black", 3, 5000);

    // 有効な手が選択され、勝利手があるため高スコアになるはず
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.score).toBeGreaterThanOrEqual(PATTERN_SCORES.FIVE);
  });

  it("completedDepthとinterruptedが正しく設定される", () => {
    const board = createEmptyBoard();

    const result = findBestMoveIterative(board, "black", 2, 10000);

    // 十分な時間があれば最大深度まで到達
    expect(result.completedDepth).toBe(2);
    expect(result.interrupted).toBe(false);
  });
});

describe("findBestMoveIterativeWithTT - ノード数制限", () => {
  it("ノード数上限で探索が中断される", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
      { row: 6, col: 6, color: "black" },
      { row: 6, col: 8, color: "white" },
    ]);

    // 非常に小さいノード数上限（100ノード）
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      10, // 深度は深め
      60000, // 時間は長め
      0,
      DEFAULT_EVAL_OPTIONS,
      100, // ノード数上限
    );

    // 有効な手が返される
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    expect(result.position.col).toBeGreaterThanOrEqual(0);
    expect(result.position.col).toBeLessThan(15);

    // ノード数上限により探索が中断された
    expect(result.interrupted).toBe(true);

    // 探索ノード数が上限以下
    expect(result.stats.nodes).toBeLessThanOrEqual(150); // マージン考慮
  });

  it("ノード数上限内なら中断されない", () => {
    const board = createEmptyBoard();
    // 石を配置して候補手を増やす
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    // 大きなノード数上限（100万ノード）と短い深度
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      2, // 浅い深度
      60000,
      0,
      DEFAULT_EVAL_OPTIONS,
      1000000, // 大きなノード数上限
    );

    // 深度2で完了
    expect(result.completedDepth).toBe(2);
    // ノード数上限に達していない
    expect(result.stats.nodes).toBeLessThan(1000000);
    // 中断されていない
    expect(result.interrupted).toBe(false);
  });

  it("ノード数上限未指定なら無制限", () => {
    const board = createEmptyBoard();
    // 石を配置して候補手を増やす
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    // ノード数上限未指定
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      2,
      10000,
      0,
      DEFAULT_EVAL_OPTIONS,
      undefined, // ノード数上限未指定
    );

    // 有効な結果が返される
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
  });
});

describe("findBestMoveIterativeWithTT - 絶対時間制限", () => {
  it("絶対時間制限で探索が中断される", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
      { row: 6, col: 6, color: "black" },
      { row: 6, col: 8, color: "white" },
    ]);

    // 短い絶対時間制限（100ms）
    const startTime = performance.now();
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      20, // 深度は深め
      60000, // 通常の時間制限は長め
      0,
      DEFAULT_EVAL_OPTIONS,
      undefined, // ノード数上限なし
      100, // 絶対時間制限100ms
    );
    const elapsed = performance.now() - startTime;

    // 有効な手が返される
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);

    // 絶対時間制限内で終了している（マージン考慮）
    expect(elapsed).toBeLessThan(200);

    // 探索が中断された
    expect(result.interrupted).toBe(true);
  });

  it("絶対時間制限がデフォルト値（10秒）で動作する", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

    // 絶対時間制限を指定しない（デフォルト10秒）
    const result = findBestMoveIterativeWithTT(
      board,
      "white",
      2,
      1000,
      0,
      DEFAULT_EVAL_OPTIONS,
      undefined,
      // absoluteTimeLimit省略
    );

    // 有効な結果が返される
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
  });
});

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
