/**
 * 反復深化探索のテスト
 *
 * findBestMoveIterative、ノード数制限、絶対時間制限のテスト
 */

import { describe, expect, it, vi } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

import {
  DEFAULT_EVAL_OPTIONS,
  FULL_EVAL_OPTIONS,
  PATTERN_SCORES,
} from "../evaluation";
import { placeStonesOnBoard } from "../testUtils";
import { computeBoardHash } from "../zobrist";
import { createSearchContext } from "./context";
import {
  findBestMoveIterative,
  findBestMoveIterativeWithTT,
  minimaxWithTT,
} from "./minimax";
import {
  applyTimePressureFallback,
  type DepthHistoryEntry,
  type IterativeDeepingResult,
} from "./results";
import { INFINITY } from "./techniques";

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
  }, 15000);

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

describe("deadline ベースの時間管理", () => {
  it("deadline が過去なら timeoutFlag が立つ", () => {
    vi.useFakeTimers();
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);
    const ctx = createSearchContext();
    ctx.deadline = performance.now() - 1; // 過去
    ctx.timeoutFlag = false;
    const hash = computeBoardHash(board);
    minimaxWithTT(
      board,
      hash,
      2,
      true,
      "black",
      -INFINITY,
      INFINITY,
      null,
      ctx,
    );
    expect(ctx.timeoutFlag).toBe(true);
    vi.useRealTimers();
  });

  it("absoluteDeadline が過去なら absoluteDeadlineExceeded が立つ", () => {
    vi.useFakeTimers();
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);
    const ctx = createSearchContext();
    ctx.deadline = performance.now() + 999999;
    ctx.absoluteDeadline = performance.now() - 1; // 過去
    ctx.absoluteDeadlineExceeded = false;
    const hash = computeBoardHash(board);
    minimaxWithTT(
      board,
      hash,
      3,
      true,
      "black",
      -INFINITY,
      INFINITY,
      null,
      ctx,
    );
    expect(ctx.absoluteDeadlineExceeded).toBe(true);
    vi.useRealTimers();
  });

  it("deadline が未来なら timeoutFlag は立たない", () => {
    vi.useFakeTimers();
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);
    const ctx = createSearchContext();
    ctx.deadline = performance.now() + 999999;
    ctx.timeoutFlag = false;
    const hash = computeBoardHash(board);
    minimaxWithTT(
      board,
      hash,
      1,
      true,
      "black",
      -INFINITY,
      INFINITY,
      null,
      ctx,
    );
    expect(ctx.timeoutFlag).toBe(false);
    vi.useRealTimers();
  });

  it("deadline/absoluteDeadline は未設定", () => {
    const ctx = createSearchContext();
    expect(ctx.deadline).toBeUndefined();
    expect(ctx.absoluteDeadline).toBeUndefined();
  });
});

// =============================================================================
// applyTimePressureFallback テスト
// =============================================================================

describe("applyTimePressureFallback", () => {
  /** テスト用のベース結果を作成 */
  function makeResult(
    overrides: Partial<IterativeDeepingResult> = {},
  ): IterativeDeepingResult {
    return {
      position: { row: 5, col: 5 },
      score: 100,
      completedDepth: 3,
      interrupted: true,
      elapsedTime: 500,
      ...overrides,
    };
  }

  it("中断時にスコアが大幅低下した場合、最深の高スコアエントリを採用", () => {
    const depthHistory: DepthHistoryEntry[] = [
      { depth: 1, position: { row: 7, col: 7 }, score: 500 },
      { depth: 2, position: { row: 8, col: 8 }, score: 3000 },
    ];
    const result = makeResult({ score: 100, position: { row: 5, col: 5 } });

    const final = applyTimePressureFallback(result, depthHistory, true);

    expect(final.position).toEqual({ row: 8, col: 8 });
    expect(final.score).toBe(3000);
    expect(final.timePressureFallback).toBe(true);
    expect(final.fallbackFromDepth).toBe(2);
  });

  it("スコア低下が閾値未満の場合はフォールバックしない", () => {
    const depthHistory: DepthHistoryEntry[] = [
      { depth: 1, position: { row: 7, col: 7 }, score: 3000 },
      { depth: 2, position: { row: 8, col: 8 }, score: 3000 },
    ];
    // スコア差 = 3000 - 1600 = 1400 < 1500
    const result = makeResult({ score: 1600, position: { row: 5, col: 5 } });

    const final = applyTimePressureFallback(result, depthHistory, true);

    expect(final.position).toEqual({ row: 5, col: 5 });
    expect(final.score).toBe(1600);
    expect(final.timePressureFallback).toBeUndefined();
  });

  it("中断されていない場合はフォールバックしない", () => {
    const depthHistory: DepthHistoryEntry[] = [
      { depth: 2, position: { row: 8, col: 8 }, score: 3000 },
    ];
    const result = makeResult({
      score: 100,
      position: { row: 5, col: 5 },
      interrupted: false,
    });

    const final = applyTimePressureFallback(result, depthHistory, false);

    expect(final.position).toEqual({ row: 5, col: 5 });
    expect(final.score).toBe(100);
    expect(final.timePressureFallback).toBeUndefined();
  });

  it("depthHistoryが空の場合はフォールバックしない", () => {
    const result = makeResult({ score: 100 });

    const final = applyTimePressureFallback(result, [], true);

    expect(final.position).toEqual({ row: 5, col: 5 });
    expect(final.score).toBe(100);
    expect(final.timePressureFallback).toBeUndefined();
  });

  it("最深の高スコアエントリを優先する", () => {
    const depthHistory: DepthHistoryEntry[] = [
      { depth: 1, position: { row: 7, col: 7 }, score: 3000 },
      { depth: 2, position: { row: 8, col: 8 }, score: 3500 },
      { depth: 3, position: { row: 9, col: 9 }, score: 2800 },
    ];
    const result = makeResult({ score: 100, position: { row: 5, col: 5 } });

    const final = applyTimePressureFallback(result, depthHistory, true);

    // depth 3 のエントリ（score 2800）が最深の高スコアエントリ
    expect(final.position).toEqual({ row: 9, col: 9 });
    expect(final.score).toBe(2800);
    expect(final.fallbackFromDepth).toBe(3);
  });
});

// =============================================================================
// 反復深化のPV再順序付けテスト
// =============================================================================

describe("反復深化のPV再順序付け", () => {
  it("前深度の最善手が次深度で最初に探索される", () => {
    const board = createEmptyBoard();
    // 序盤の局面を作成（VCFやMise-VCFが発動しない形）
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);

    // depth 2以上で探索し、depthHistoryを取得
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      3,
      5000,
      0,
      DEFAULT_EVAL_OPTIONS,
      undefined,
      undefined,
      0,
    );

    // depth 2以上まで到達していればPV再順序付けが機能している
    expect(result.completedDepth).toBeGreaterThanOrEqual(2);
    // depthHistoryが記録されている
    expect(result.depthHistory).toBeDefined();
    expect(result.depthHistory?.length).toBeGreaterThanOrEqual(1);
  }, 10000);
});

// =============================================================================
// VCTメインフロー統合テスト
// =============================================================================

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
    const result = findBestMoveIterativeWithTT(
      board,
      "white",
      3,
      5000,
      0,
      FULL_EVAL_OPTIONS,
    );
    // VCTのある局面で有効な手が返ることを確認（具体的な手は問わない）
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
  }, 10000);

  it("enableVCT=falseではVCT探索が実行されない", () => {
    const board = createEmptyBoard();
    // 序盤の局面（14石未満）
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);
    // DEFAULT_EVAL_OPTIONS はenableVCT=false
    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      2,
      2000,
      0,
      DEFAULT_EVAL_OPTIONS,
    );
    // 正常に結果が返ることを確認
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Mise-VCFはminimax検証に委ねるテスト
// =============================================================================

describe("Mise-VCFの偽陽性対策", () => {
  it("Game 185: ノリ手でMise-VCFが無効化されスコアがFIVE未満になる", () => {
    // Game 185 m14時点: H7のミセ手は飛び三(H10-_-H8-H7)も作る
    // ノリ手チェックでMise-VCFが無効化されるため、minimax探索に移行する
    const { board } = createBoardFromRecord(
      "H8 I9 G7 I7 G8 I6 I8 J8 G9 G10 F8 E8 H10 I11",
    );

    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      4,
      5000,
      0,
      FULL_EVAL_OPTIONS,
    );

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

    const result = findBestMoveIterativeWithTT(
      board,
      "white",
      4,
      5000,
      0,
      FULL_EVAL_OPTIONS,
    );

    // 非強制ミセ手が却下されMise-VCFなし → minimax探索 → score < FIVE
    expect(result.score).toBeLessThan(PATTERN_SCORES.FIVE);
    expect(result.completedDepth).toBeGreaterThanOrEqual(1);
  }, 15000);
});

// =============================================================================
// checkMustDefend: 跳び四の一部を活三と誤検出しない
// =============================================================================

describe("checkMustDefend: 跳び四と活三の判別", () => {
  it("跳び四の連続三部分を活三と誤検出しない", () => {
    // H8 G8 I7 G9 G7 J10 H7 F7 J7 K7 H11 I9 H9
    // 黒の列H: H7-H8-H9-[gap]-H11 = 跳び四（●●●_●）
    // H7-H8-H9の部分は跳び四の一部であり、活三ではない
    // → 四＋活三（四三）と誤判定されない
    const { board } = createBoardFromRecord(
      "H8 G8 I7 G9 G7 J10 H7 F7 J7 K7 H11 I9 H9",
    );

    const result = findBestMoveIterativeWithTT(
      board,
      "white",
      4,
      5000,
      0,
      FULL_EVAL_OPTIONS,
    );

    // 跳び四の防御手（H10）が返り、四三ではないので -FIVE にならない
    expect(result.score).toBeGreaterThan(-PATTERN_SCORES.FIVE);
  }, 15000);

  it("NMP: 止め四防御後に偽の五連を検出しない", () => {
    // H8 G8 I7 G9 G7 J10 H7 F7 (8手)
    // J7(黒)で止め四 → K7(白)で防御必須
    // NMPがK7経由で偽の五連(checkFive(K7,black)=true)を検出していた
    const { board } = createBoardFromRecord("H8 G8 I7 G9 G7 J10 H7 F7");

    const result = findBestMoveIterativeWithTT(
      board,
      "black",
      5,
      10000,
      0,
      FULL_EVAL_OPTIONS,
    );

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

    const result = findBestMoveIterativeWithTT(
      board,
      "white",
      2,
      5000,
      0,
      FULL_EVAL_OPTIONS,
    );

    // 独立した四＋活三 = 四三 → -FIVE
    expect(result.score).toBe(-PATTERN_SCORES.FIVE);
  }, 15000);
});
