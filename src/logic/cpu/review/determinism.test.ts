/**
 * 振り返り評価の決定論性テスト
 *
 * 同じ局面を複数回評価しても同じ結果が返ることを検証する。
 * timeLimit 未指定（review パス）で performance.now() 依存がないことを確認。
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import { findBestMoveIterativeWithTT } from "../search/minimax";
import { globalTT } from "../transpositionTable";
import { REVIEW_SEARCH_PARAMS } from "./reviewConstants";

/** 簡素な局面（高速に完了する） */
const SIMPLE_RECORD = "H8 I9 F7 G8 I7 G7";

describe("振り返り評価の決定論性", () => {
  it("TTクリア後の minimax 探索は決定論的（timeLimit 未指定）", () => {
    const { board } = createBoardFromRecord(SIMPLE_RECORD);

    // 1回目: TTクリア → 探索（timeLimit 未指定 = review パス）
    globalTT.clear();
    const result1 = findBestMoveIterativeWithTT({
      board,
      color: "black",
      maxDepth: 4,
      randomFactor: 0,
      evaluationOptions: REVIEW_SEARCH_PARAMS.evaluationOptions,
      maxNodes: 10_000,
    });

    // 2回目: TTクリア → 探索
    globalTT.clear();
    const result2 = findBestMoveIterativeWithTT({
      board,
      color: "black",
      maxDepth: 4,
      randomFactor: 0,
      evaluationOptions: REVIEW_SEARCH_PARAMS.evaluationOptions,
      maxNodes: 10_000,
    });

    expect(result2.position).toEqual(result1.position);
    expect(result2.score).toBe(result1.score);
    expect(result2.completedDepth).toBe(result1.completedDepth);
  });

  it("3回連続で同じ結果が返る", () => {
    const { board } = createBoardFromRecord(SIMPLE_RECORD);
    const results = [];

    for (let i = 0; i < 3; i++) {
      globalTT.clear();
      results.push(
        findBestMoveIterativeWithTT({
          board,
          color: "black",
          maxDepth: 4,
          randomFactor: 0,
          evaluationOptions: REVIEW_SEARCH_PARAMS.evaluationOptions,
          maxNodes: 10_000,
        }),
      );
    }

    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.position).toEqual(results[0]!.position);
      expect(results[i]!.score).toBe(results[0]!.score);
    }
  });
});
