/**
 * プロファイリングカウンターのテスト
 */

import { describe, expect, it, beforeEach } from "vitest";

import {
  getCounters,
  incrementBoardCopies,
  incrementEvaluationCalls,
  incrementForbiddenCheckCalls,
  incrementThreatDetectionCalls,
  resetCounters,
} from "./counters";

describe("プロファイリングカウンター", () => {
  beforeEach(() => {
    resetCounters();
  });

  it("初期状態は全て0", () => {
    const counters = getCounters();
    expect(counters.forbiddenCheckCalls).toBe(0);
    expect(counters.boardCopies).toBe(0);
    expect(counters.threatDetectionCalls).toBe(0);
    expect(counters.evaluationCalls).toBe(0);
  });

  it("禁手判定カウンターをインクリメント", () => {
    incrementForbiddenCheckCalls();
    incrementForbiddenCheckCalls();
    incrementForbiddenCheckCalls();

    const counters = getCounters();
    expect(counters.forbiddenCheckCalls).toBe(3);
  });

  it("盤面コピーカウンターをインクリメント", () => {
    incrementBoardCopies();
    incrementBoardCopies();

    const counters = getCounters();
    expect(counters.boardCopies).toBe(2);
  });

  it("脅威検出カウンターをインクリメント", () => {
    incrementThreatDetectionCalls();

    const counters = getCounters();
    expect(counters.threatDetectionCalls).toBe(1);
  });

  it("評価関数カウンターをインクリメント", () => {
    incrementEvaluationCalls();
    incrementEvaluationCalls();
    incrementEvaluationCalls();
    incrementEvaluationCalls();

    const counters = getCounters();
    expect(counters.evaluationCalls).toBe(4);
  });

  it("resetCountersで全てリセット", () => {
    incrementForbiddenCheckCalls();
    incrementBoardCopies();
    incrementThreatDetectionCalls();
    incrementEvaluationCalls();

    resetCounters();

    const counters = getCounters();
    expect(counters.forbiddenCheckCalls).toBe(0);
    expect(counters.boardCopies).toBe(0);
    expect(counters.threatDetectionCalls).toBe(0);
    expect(counters.evaluationCalls).toBe(0);
  });

  it("getCountersはコピーを返す（イミュータブル）", () => {
    const counters1 = getCounters();
    incrementForbiddenCheckCalls();
    const counters2 = getCounters();

    // counters1は古い値のまま
    expect(counters1.forbiddenCheckCalls).toBe(0);
    // counters2は新しい値
    expect(counters2.forbiddenCheckCalls).toBe(1);
  });
});
