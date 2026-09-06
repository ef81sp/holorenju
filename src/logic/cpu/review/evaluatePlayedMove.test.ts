/**
 * probePlayedMoveScore テスト（B1: 誤blunder修正 / 実手実評価）
 *
 * 実手が minimax 候補(top5)外のとき、従来は playedScore=bestScore-2000 固定で
 * 機械的に blunder 判定されていた。実手局面を浅く追加探索し実スコアを推定する。
 *
 * モックエンジンで純粋にヘルパーのロジック（符号反転・盤面置換/復元・手番・不正座標）を検証する。
 */

import { describe, expect, it, vi } from "vitest";

import type { BoardState } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

import type { MoveScoreEntry } from "../search/types";
import type { WasmSearchEngine } from "../wasm/searchEngine";

import { PATTERN_SCORES } from "../evaluation";
import {
  evaluatePlayedForcedWin,
  probePlayedMoveScore,
  resolvePlayedScore,
} from "./evaluatePlayedMove";

function mockEngine(score: number): WasmSearchEngine {
  return {
    findBestMoveWithParamsNoTTClear: vi.fn(() => ({
      position: { row: 0, col: 0 },
      score,
      completedDepth: 3,
    })),
  } as unknown as WasmSearchEngine;
}

describe("probePlayedMoveScore（B1: 実手実評価）", () => {
  it("相手視点スコアを符号反転して実手側スコアを返す", () => {
    const board = createEmptyBoard();
    const engine = mockEngine(1234);
    expect(probePlayedMoveScore(board, 7, 7, "black", engine)).toBe(-1234);
  });

  it("探索中は実手を盤面に置き、終了後に戻す", () => {
    const board = createEmptyBoard();
    let placedDuringSearch = false;
    const engine = {
      findBestMoveWithParamsNoTTClear: vi.fn((b: BoardState) => {
        placedDuringSearch = b[7]?.includes("black") ?? false;
        return { position: { row: 0, col: 0 }, score: 0, completedDepth: 3 };
      }),
    } as unknown as WasmSearchEngine;
    probePlayedMoveScore(board, 7, 7, "black", engine);
    expect(placedDuringSearch).toBe(true);
    expect(board[7]?.includes("black") ?? false).toBe(false);
  });

  it("実手を置いた後の相手番で探索する", () => {
    const board = createEmptyBoard();
    const engine = mockEngine(500);
    probePlayedMoveScore(board, 7, 7, "black", engine);
    const mock = vi.mocked(engine.findBestMoveWithParamsNoTTClear);
    expect(mock.mock.calls[0]?.[1]).toBe("white");
  });

  it("既に石がある座標では null を返し探索しない", () => {
    const board = createEmptyBoard();
    board[7]![7] = "white";
    const engine = mockEngine(100);
    expect(probePlayedMoveScore(board, 7, 7, "black", engine)).toBeNull();
    expect(engine.findBestMoveWithParamsNoTTClear).not.toHaveBeenCalled();
  });

  it("盤外座標では null を返す", () => {
    const board = createEmptyBoard();
    const engine = mockEngine(100);
    expect(probePlayedMoveScore(board, -1, 7, "black", engine)).toBeNull();
  });
});

// ─── 境界値の不採用（review-multipv-2026-09-06.md §2.5 / §3-7） ───

vi.mock("./wasmAdapters", () => ({
  wasmFindVCFSequenceFromFirstMove: vi.fn(() => null),
  wasmFindVCTSequenceFromFirstMove: vi.fn(() => null),
  wasmIsVCTFirstMove: vi.fn(() => false),
}));

describe("resolvePlayedScore（§2.5 経路 1・2 の共通規則）", () => {
  const played = { row: 7, col: 8 };
  const FALLBACK = -9999;

  it("実手候補が scoreExact=true ならそのスコア（probe しない）", () => {
    const probe = vi.fn(() => 700);
    const candidates: MoveScoreEntry[] = [
      { move: { row: 7, col: 7 }, score: 900, scoreExact: true },
      { move: played, score: 500, scoreExact: true },
    ];
    expect(resolvePlayedScore(candidates, 7, 8, probe, FALLBACK)).toBe(500);
    expect(probe).not.toHaveBeenCalled();
  });

  it("境界値 500・probe 700 → 500（上限を超えない）", () => {
    const candidates: MoveScoreEntry[] = [{ move: played, score: 500 }];
    expect(resolvePlayedScore(candidates, 7, 8, () => 700, FALLBACK)).toBe(500);
  });

  it("境界値 500・probe 300 → 300（min）", () => {
    const candidates: MoveScoreEntry[] = [
      { move: played, score: 500, scoreExact: false },
    ];
    expect(resolvePlayedScore(candidates, 7, 8, () => 300, FALLBACK)).toBe(300);
  });

  it("境界値・probe 不能(null) → 境界値のまま", () => {
    const candidates: MoveScoreEntry[] = [{ move: played, score: 500 }];
    expect(resolvePlayedScore(candidates, 7, 8, () => null, FALLBACK)).toBe(
      500,
    );
  });

  it("実手が候補外なら probe 値、probe 不能なら fallback", () => {
    const candidates: MoveScoreEntry[] = [
      { move: { row: 7, col: 7 }, score: 900, scoreExact: true },
    ];
    expect(resolvePlayedScore(candidates, 7, 8, () => 250, FALLBACK)).toBe(250);
    expect(resolvePlayedScore(candidates, 7, 8, () => null, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolvePlayedScore(undefined, 7, 8, () => null, FALLBACK)).toBe(
      FALLBACK,
    );
  });
});

describe("evaluatePlayedForcedWin は境界値を採用しない（§2.5 経路 1）", () => {
  const bestMove = { row: 7, col: 7 };

  it("実手候補が scoreExact=true なら候補スコアを採用し probe しない", () => {
    const board = createEmptyBoard();
    const engine = mockEngine(999);
    const result = {
      score: 300,
      candidates: [
        { move: bestMove, score: 300, scoreExact: true },
        { move: { row: 7, col: 8 }, score: 120, scoreExact: true },
      ] satisfies MoveScoreEntry[],
    };
    const out = evaluatePlayedForcedWin(
      board,
      "black",
      7,
      8,
      bestMove,
      PATTERN_SCORES.FIVE,
      result,
      engine,
    );
    expect(out.playedScore).toBe(120);
    expect(engine.findBestMoveWithParamsNoTTClear).not.toHaveBeenCalled();
  });

  it("実手候補が境界値なら probe との min（probe が上回れば境界値）", () => {
    const board = createEmptyBoard();
    // probe は相手視点 -450 → 実手側 +450 > 境界値 120 → 120
    const engine = mockEngine(-450);
    const result = {
      score: 300,
      candidates: [
        { move: bestMove, score: 300, scoreExact: true },
        { move: { row: 7, col: 8 }, score: 120 },
      ] satisfies MoveScoreEntry[],
    };
    const out = evaluatePlayedForcedWin(
      board,
      "black",
      7,
      8,
      bestMove,
      PATTERN_SCORES.FIVE,
      result,
      engine,
    );
    expect(engine.findBestMoveWithParamsNoTTClear).toHaveBeenCalledTimes(1);
    expect(out.playedScore).toBe(120);
  });

  it("実手候補が境界値で probe が下回れば probe 値", () => {
    const board = createEmptyBoard();
    // probe は相手視点 +50 → 実手側 -50 < 境界値 120 → -50
    const engine = mockEngine(50);
    const result = {
      score: 300,
      candidates: [
        { move: bestMove, score: 300, scoreExact: true },
        { move: { row: 7, col: 8 }, score: 120 },
      ] satisfies MoveScoreEntry[],
    };
    const out = evaluatePlayedForcedWin(
      board,
      "black",
      7,
      8,
      bestMove,
      PATTERN_SCORES.FIVE,
      result,
      engine,
    );
    expect(out.playedScore).toBe(-50);
  });

  it("実手 = 最善手なら bestScore をそのまま返す（scoreExact 不問）", () => {
    const board = createEmptyBoard();
    const engine = mockEngine(0);
    const result = {
      score: 300,
      candidates: [{ move: bestMove, score: 300 }] satisfies MoveScoreEntry[],
    };
    const out = evaluatePlayedForcedWin(
      board,
      "black",
      7,
      7,
      bestMove,
      PATTERN_SCORES.FIVE,
      result,
      engine,
    );
    expect(out.playedScore).toBe(PATTERN_SCORES.FIVE);
    expect(engine.findBestMoveWithParamsNoTTClear).not.toHaveBeenCalled();
  });
});
