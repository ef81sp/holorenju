/**
 * Phase 0: プロファイリング
 *
 * ビットボード導入前に、ボトルネックが board 走査にあることを定量的に確認する。
 * 代表的な盤面で Iterative Deepening を走らせ、関数別のCPU時間占有率を計測。
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import { evaluateBoard } from "../evaluation/boardEvaluation";
import { evaluatePosition } from "../evaluation/positionEvaluation";
import { findBestMoveIterativeWithTT } from "../search/iterativeDeepening";
import { globalTT } from "../transpositionTable";

// === 代表的な盤面（VCFが見つからない穏やかな局面を使用） ===

/** 序盤: 6手（黒3白3）— 散らした配置で即勝ちなし */
const OPENING_RECORD = "H8 I9 J10 G7 F6 K11";

/** 中盤: 16手（黒8白8）— 拮抗した局面 */
const MIDGAME_RECORD = "H8 I9 J10 G7 F6 K11 H6 H10 I8 G9 J8 F10 G8 I7 K8 E8";

/** 終盤: 26手（黒13白13）— 盤面が埋まってきた局面 */
const ENDGAME_RECORD =
  "H8 I9 J10 G7 F6 K11 H6 H10 I8 G9 J8 F10 G8 I7 K8 E8 I6 J6 H7 G6 F5 E4 J9 K10 I10 H9";

/** 終盤: 26手（黒13白13）— VCFが見つからない拮抗局面 */
const ENDGAME_RECORD2 =
  "H8 I9 J10 G7 F6 K11 H6 H10 I8 G9 J8 F10 G8 I7 K8 E8 I6 J6 H7 G6 E7 F8 K9 L10 J7 K7";

/** 探索パラメータ */
const MAX_DEPTH = 6;
const TIME_LIMIT = 3000;
const MAX_NODES = 30000;

describe("Phase 0: ボトルネック計測", () => {
  it("序盤・中盤・終盤での探索統計を収集", () => {
    const scenarios = [
      { name: "序盤 (6手)", record: OPENING_RECORD },
      { name: "中盤 (16手)", record: MIDGAME_RECORD },
      { name: "終盤 (26手)", record: ENDGAME_RECORD2 },
    ];

    for (const scenario of scenarios) {
      const { board, nextColor } = createBoardFromRecord(scenario.record);

      // TT をクリアして公平な計測
      globalTT.clear();

      const startTime = performance.now();
      const result = findBestMoveIterativeWithTT(
        board,
        nextColor,
        MAX_DEPTH,
        TIME_LIMIT,
        0, // randomFactor
        undefined, // default eval options
        MAX_NODES,
      );
      const totalTime = performance.now() - startTime;

      console.log(`\n=== ${scenario.name} ===`);
      console.log(`  総時間: ${totalTime.toFixed(1)}ms`);
      console.log(`  完了深度: ${result.completedDepth}`);
      console.log(`  探索ノード: ${result.stats.nodes}`);
      console.log(`  TTヒット: ${result.stats.ttHits}`);
      console.log(`  TTカットオフ: ${result.stats.ttCutoffs}`);
      console.log(`  Betaカットオフ: ${result.stats.betaCutoffs}`);
      console.log(`  NullMoveカットオフ: ${result.stats.nullMoveCutoffs}`);
      console.log(`  Futilityプルーン: ${result.stats.futilityPrunes}`);
      console.log(`  評価関数呼出: ${result.stats.evaluationCalls}`);
      console.log(`  禁手判定呼出: ${result.stats.forbiddenCheckCalls}`);
      console.log(`  脅威検出呼出: ${result.stats.threatDetectionCalls}`);
      console.log(`  盤面コピー: ${result.stats.boardCopies}`);
      if (result.stats.nodes > 0) {
        const evalRate =
          (result.stats.evaluationCalls / result.stats.nodes) * 100;
        console.log(`  評価/ノード比: ${evalRate.toFixed(1)}%`);
        const ttHitRate = (result.stats.ttHits / result.stats.nodes) * 100;
        console.log(`  TTヒット率: ${ttHitRate.toFixed(1)}%`);
      }

      // 基本的な健全性チェック（VCFで即座に返る場合もあるのでゆるく）
      expect(result.completedDepth).toBeGreaterThanOrEqual(0);
    }
  }, 30000);

  it("evaluateBoard 単体のマイクロベンチマーク", () => {
    const scenarios = [
      { name: "序盤 (6手)", record: OPENING_RECORD },
      { name: "中盤 (16手)", record: MIDGAME_RECORD },
      { name: "終盤 (26手)", record: ENDGAME_RECORD },
    ];

    const ITERATIONS = 1000;

    for (const scenario of scenarios) {
      const { board, nextColor } = createBoardFromRecord(scenario.record);

      // evaluateBoard のウォームアップ
      evaluateBoard(board, nextColor);

      const start = performance.now();
      for (let i = 0; i < ITERATIONS; i++) {
        evaluateBoard(board, nextColor);
      }
      const elapsed = performance.now() - start;
      const perCall = elapsed / ITERATIONS;

      console.log(`\n=== evaluateBoard: ${scenario.name} ===`);
      console.log(`  ${ITERATIONS}回: ${elapsed.toFixed(1)}ms`);
      console.log(`  1回あたり: ${perCall.toFixed(3)}ms`);
      console.log(`  1秒あたり: ${Math.floor(1000 / perCall)}回`);

      expect(perCall).toBeGreaterThan(0);
    }
  });

  it("evaluatePosition 単体のマイクロベンチマーク", () => {
    const { board } = createBoardFromRecord(MIDGAME_RECORD);
    const ITERATIONS = 5000;

    // 空きセルを収集
    const emptyCells: { row: number; col: number }[] = [];
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        if (board[r]?.[c] === null) {
          emptyCells.push({ row: r, col: c });
        }
      }
    }

    // evaluatePosition のウォームアップ
    evaluatePosition(board, 7, 7, "black");

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      const cell = emptyCells[i % emptyCells.length]!;
      evaluatePosition(board, cell.row, cell.col, "black");
    }
    const elapsed = performance.now() - start;
    const perCall = elapsed / ITERATIONS;

    console.log("\n=== evaluatePosition: 中盤 (16手) ===");
    console.log(`  ${ITERATIONS}回: ${elapsed.toFixed(1)}ms`);
    console.log(`  1回あたり: ${perCall.toFixed(4)}ms`);
    console.log(`  1秒あたり: ${Math.floor(1000 / perCall)}回`);

    expect(perCall).toBeGreaterThan(0);
  });

  it("evaluateBoard の時間占有率を概算", () => {
    const { board, nextColor } = createBoardFromRecord(MIDGAME_RECORD);

    // 1. evaluateBoard 1回あたりの時間を計測
    const EVAL_ITERATIONS = 1000;
    evaluateBoard(board, nextColor); // ウォームアップ
    const evalStart = performance.now();
    for (let i = 0; i < EVAL_ITERATIONS; i++) {
      evaluateBoard(board, nextColor);
    }
    const evalPerCall = (performance.now() - evalStart) / EVAL_ITERATIONS;

    // 2. 探索を実行して evaluationCalls を取得
    globalTT.clear();
    const searchStart = performance.now();
    const result = findBestMoveIterativeWithTT(
      board,
      nextColor,
      MAX_DEPTH,
      TIME_LIMIT,
      0,
      undefined,
      MAX_NODES,
    );
    const searchTotal = performance.now() - searchStart;

    // 3. evaluateBoard の推定占有時間
    const evalCalls = result.stats.evaluationCalls;
    const estimatedEvalTime = evalCalls * evalPerCall;
    const evalPercent =
      searchTotal > 0 ? (estimatedEvalTime / searchTotal) * 100 : 0;

    console.log("\n=== evaluateBoard 時間占有率推定（中盤 16手） ===");
    console.log(`  探索総時間: ${searchTotal.toFixed(1)}ms`);
    console.log(`  探索ノード: ${result.stats.nodes}`);
    console.log(`  evaluateBoard 1回: ${evalPerCall.toFixed(3)}ms`);
    console.log(`  evaluateBoard 呼出回数: ${evalCalls}`);
    console.log(`  evaluateBoard 推定時間: ${estimatedEvalTime.toFixed(1)}ms`);
    console.log(`  推定占有率: ${evalPercent.toFixed(1)}%`);
    console.log(
      `  残り（探索オーバーヘッド等）: ${(100 - evalPercent).toFixed(1)}%`,
    );

    // 結果が計算できていることのチェック
    expect(evalPercent).not.toBeNaN();
  }, 30000);
});
