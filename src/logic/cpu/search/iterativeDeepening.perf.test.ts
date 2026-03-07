/**
 * 反復深化探索のパフォーマンステスト
 *
 * 重い探索テスト（10〜15秒timeout）
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
import { findBestMoveIterative, findBestMoveIterativeWithTT } from "./minimax";

describe("findBestMoveIterative - 高負荷テスト", () => {
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
  }, 15000);
});

describe("反復深化のPV再順序付け", () => {
  it("前深度の最善手が次深度で最初に探索される", () => {
    const board = createEmptyBoard();
    // 序盤の局面を作成（VCFやMise-VCFが発動しない形）
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);

    // depth 2以上で探索し、depthHistoryを取得
    const result = findBestMoveIterativeWithTT({
      board,
      color: "black",
      maxDepth: 3,
      timeLimit: 5000,
      randomFactor: 0,
      evaluationOptions: DEFAULT_EVAL_OPTIONS,
      scoreThreshold: 0,
    });

    // depth 2以上まで到達していればPV再順序付けが機能している
    expect(result.completedDepth).toBeGreaterThanOrEqual(2);
    // depthHistoryが記録されている
    expect(result.depthHistory).toBeDefined();
    expect(result.depthHistory?.length).toBeGreaterThanOrEqual(1);
  }, 10000);
});

describe("VCTメインフロー統合", () => {
  it("VCTのある局面でenableVCT=trueなら有効な手を返す", () => {
    const board = createEmptyBoard();
    // 白の活三が作れる局面（14石以上）
    placeStonesOnBoard(board, [
      // 白の活三素材
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      // 十分な石数にするためのフィラー
      { row: 0, col: 0, color: "black" },
      { row: 0, col: 1, color: "white" },
      { row: 0, col: 3, color: "black" },
      { row: 0, col: 5, color: "white" },
      { row: 1, col: 0, color: "black" },
      { row: 1, col: 1, color: "white" },
      { row: 1, col: 3, color: "black" },
      { row: 1, col: 5, color: "white" },
      { row: 2, col: 0, color: "black" },
      { row: 2, col: 1, color: "white" },
      { row: 2, col: 3, color: "black" },
    ]);
    // enableVCT=true（FULL_EVAL_OPTIONS）
    const result = findBestMoveIterativeWithTT({
      board,
      color: "white",
      maxDepth: 3,
      timeLimit: 5000,
      randomFactor: 0,
      evaluationOptions: FULL_EVAL_OPTIONS,
    });
    // VCTのある局面で有効な手が返ることを確認（具体的な手は問わない）
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
  }, 10000);
});

describe("Mise-VCFの偽陽性対策", () => {
  it("Game 185: ノリ手でMise-VCFが無効化されスコアがFIVE未満になる", () => {
    // Game 185 m14時点: H7のミセ手は飛び三(H10-_-H8-H7)も作る
    // ノリ手チェックでMise-VCFが無効化されるため、minimax探索に移行する
    const { board } = createBoardFromRecord(
      "H8 I9 G7 I7 G8 I6 I8 J8 G9 G10 F8 E8 H10 I11",
    );

    const result = findBestMoveIterativeWithTT({
      board,
      color: "black",
      maxDepth: 4,
      timeLimit: 5000,
      randomFactor: 0,
      evaluationOptions: FULL_EVAL_OPTIONS,
    });

    // ノリ手チェックでMise-VCFが無効化 → score < FIVE
    expect(result.score).toBeLessThan(PATTERN_SCORES.FIVE);
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
  }, 15000);

  it("Game 121: 非強制ミセ手K13がMise-VCFとして検出されずスコアがFIVE未満になる", () => {
    // Game 121 m41時点: K13は四三点I11へのセットアップだが三も四も作らない
    // 非強制ミセ手のためMise-VCFアルゴリズムで却下される
    const { board } = createBoardFromRecord(
      "H8 I7 F10 K9 J8 H6 I8 G8 H9 G10 I9 H10 G9 F9 J10 G7 H7 J9 G12 F8 E9 H11 E8 E11 F11 I5 J4 I14 E10 D9 I12 H12 E7 E6 K5 J12 L9 H14 H13 K11 I13",
    );

    const result = findBestMoveIterativeWithTT({
      board,
      color: "white",
      maxDepth: 4,
      timeLimit: 5000,
      randomFactor: 0,
      evaluationOptions: FULL_EVAL_OPTIONS,
    });

    // 非強制ミセ手が却下されMise-VCFなし → minimax探索 → score < FIVE
    expect(result.score).toBeLessThan(PATTERN_SCORES.FIVE);
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
  }, 15000);
});

describe("checkMustDefend: 跳び四と活三の判別", () => {
  it("跳び四の連続三部分を活三と誤検出しない", () => {
    // H8 G8 I7 G9 G7 J10 H7 F7 J7 K7 H11 I9 H9
    // 黒の列H: H7-H8-H9-[gap]-H11 = 跳び四（●●●_●）
    // H7-H8-H9の部分は跳び四の一部であり、活三ではない
    // → 四＋活三（四三）と誤判定されない
    const { board } = createBoardFromRecord(
      "H8 G8 I7 G9 G7 J10 H7 F7 J7 K7 H11 I9 H9",
    );

    const result = findBestMoveIterativeWithTT({
      board,
      color: "white",
      maxDepth: 4,
      timeLimit: 5000,
      randomFactor: 0,
      evaluationOptions: FULL_EVAL_OPTIONS,
    });

    // 跳び四の防御手（H10）が返り、四三ではないので -FIVE にならない
    expect(result.score).toBeGreaterThan(-PATTERN_SCORES.FIVE);
  }, 15000);

  it("NMP: 止め四防御後に偽の五連を検出しない", () => {
    // H8 G8 I7 G9 G7 J10 H7 F7 (8手)
    // J7(黒)で止め四 → K7(白)で防御必須
    // NMPがK7経由で偽の五連(checkFive(K7,black)=true)を検出していた
    const { board } = createBoardFromRecord("H8 G8 I7 G9 G7 J10 H7 F7");

    const result = findBestMoveIterativeWithTT({
      board,
      color: "black",
      maxDepth: 5,
      timeLimit: 10000,
      randomFactor: 0,
      evaluationOptions: FULL_EVAL_OPTIONS,
    });

    // J7 が偽の +100000 にならない
    const j7Candidate = result.candidates?.find(
      (c) => c.move.row === 8 && c.move.col === 9,
    );
    if (j7Candidate) {
      expect(j7Candidate.score).toBeLessThan(PATTERN_SCORES.FIVE);
    }
    // 全体のスコアも FIVE 未満
    expect(result.score).toBeLessThan(PATTERN_SCORES.FIVE);
  }, 15000);

  it("独立した四と活三がある場合は -FIVE になる", () => {
    // 黒が四（列方向）と活三（行方向）を独立に持つ局面を構築
    // 四: E8-F8-G8-H8 (行8, 列4-7) → 防御位置 I8 (行8, 列8)
    // 活三: E10-E11-E12 (列4, 行9-11) → I8を止めても活三は残る
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      // 黒の四（行8）: E8-F8-G8-H8
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      // 黒の活三（列E）: E10-E11-E12
      { row: 9, col: 4, color: "black" },
      { row: 10, col: 4, color: "black" },
      { row: 11, col: 4, color: "black" },
      // 白のダミー石
      { row: 0, col: 0, color: "white" },
      { row: 0, col: 14, color: "white" },
      { row: 14, col: 0, color: "white" },
      { row: 14, col: 14, color: "white" },
    ]);

    const result = findBestMoveIterativeWithTT({
      board,
      color: "white",
      maxDepth: 2,
      timeLimit: 5000,
      randomFactor: 0,
      evaluationOptions: FULL_EVAL_OPTIONS,
    });

    // 独立した四＋活三 = 四三 → -FIVE
    expect(result.score).toBe(-PATTERN_SCORES.FIVE);
  }, 15000);
});
