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

import type { WasmSearchEngine } from "../wasm/searchEngine";

import { probePlayedMoveScore } from "./evaluatePlayedMove";

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
