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
  resolvePlayedCandidateScore,
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

describe("resolvePlayedCandidateScore（§2.5 経路 1・2 の共通規則）", () => {
  it("実手候補が scoreExact=true ならそのスコアを返す", () => {
    const candidates: MoveScoreEntry[] = [
      { move: { row: 7, col: 7 }, score: 300, scoreExact: true },
      { move: { row: 7, col: 8 }, score: 120, scoreExact: true },
    ];
    expect(resolvePlayedCandidateScore(candidates, 7, 8)).toBe(120);
  });

  it("実手候補が境界値（scoreExact 省略）なら undefined", () => {
    const candidates: MoveScoreEntry[] = [
      { move: { row: 7, col: 7 }, score: 300 },
      { move: { row: 7, col: 8 }, score: 120 },
    ];
    expect(resolvePlayedCandidateScore(candidates, 7, 8)).toBeUndefined();
  });

  it("実手候補が scoreExact=false なら undefined", () => {
    const candidates: MoveScoreEntry[] = [
      { move: { row: 7, col: 8 }, score: 120, scoreExact: false },
    ];
    expect(resolvePlayedCandidateScore(candidates, 7, 8)).toBeUndefined();
  });

  it("実手が候補外なら undefined", () => {
    const candidates: MoveScoreEntry[] = [
      { move: { row: 7, col: 7 }, score: 300, scoreExact: true },
    ];
    expect(resolvePlayedCandidateScore(candidates, 0, 0)).toBeUndefined();
    expect(resolvePlayedCandidateScore(undefined, 0, 0)).toBeUndefined();
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

  it("実手候補が境界値なら probePlayedMoveScore に落ちる", () => {
    const board = createEmptyBoard();
    // probe は相手視点 -450 → 実手側 +450
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
    expect(out.playedScore).toBe(450);
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
