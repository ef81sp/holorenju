import { describe, expect, it } from "vitest";

import type { EvaluatedMove, ReviewCandidate } from "@/types/review";

import { buildCandidateViews, candidateAriaLabel } from "./candidateViewModel";

const pos = (row: number, col: number): { row: number; col: number } => ({
  row,
  col,
});

function evalWith(
  candidates: ReviewCandidate[],
  played: { row: number; col: number },
  best: { row: number; col: number },
): EvaluatedMove {
  return {
    moveIndex: 9,
    position: played,
    isPlayerMove: true,
    quality: "inaccuracy",
    playedScore: 0,
    bestScore: 0,
    scoreDiff: 0,
    bestMove: best,
    candidates,
  } as EvaluatedMove;
}

describe("buildCandidateViews", () => {
  it("候補が無ければ空", () => {
    expect(buildCandidateViews(evalWith([], pos(7, 7), pos(7, 7)))).toEqual([]);
  });

  it("最善・自分の手を必ず含めて 3 件に絞り、元の順位を残す", () => {
    const candidates: ReviewCandidate[] = [
      { position: pos(1, 1), searchScore: 500, scoreExact: true },
      { position: pos(2, 2), searchScore: 450, scoreExact: true },
      { position: pos(3, 3), searchScore: 300, scoreExact: true },
      { position: pos(4, 4), searchScore: 200, scoreExact: true },
      { position: pos(5, 5), searchScore: -100 },
    ];
    const views = buildCandidateViews(
      evalWith(candidates, pos(5, 5), pos(1, 1)),
    );
    expect(views.map((v) => [v.rank, v.kind, v.grade])).toEqual([
      [1, "best", "S"],
      [2, "alt", "A"],
      [5, "actual", "C"],
    ]);
    expect(views[2]?.isBound).toBe(true);
    expect(views[2]?.deltaLabel).toBe("≤-600");
  });

  it("最善を打った手は best として 1 枚だけ", () => {
    const candidates: ReviewCandidate[] = [
      { position: pos(1, 1), searchScore: 500, scoreExact: true },
      { position: pos(2, 2), searchScore: 100, scoreExact: true },
    ];
    const views = buildCandidateViews(
      evalWith(candidates, pos(1, 1), pos(1, 1)),
    );
    expect(views.map((v) => v.kind)).toEqual(["best", "alt"]);
    // 差 400 ちょうどは疑問手の範囲（B）で、ゲージは底
    expect(views[1]?.grade).toBe("B");
    expect(views[1]?.gaugeRatio).toBe(0);
  });

  it("ゲージは最善で満タン、差に比例して短くなる", () => {
    const candidates: ReviewCandidate[] = [
      { position: pos(1, 1), searchScore: 500, scoreExact: true },
      { position: pos(2, 2), searchScore: 400, scoreExact: true },
    ];
    const views = buildCandidateViews(
      evalWith(candidates, pos(2, 2), pos(1, 1)),
    );
    expect(views[0]?.gaugeRatio).toBe(1);
    expect(views[1]?.gaugeRatio).toBeCloseTo(0.75);
  });
});

describe("candidateAriaLabel", () => {
  it("順位・座標・役割・差・フラグを読み上げる", () => {
    const candidates: ReviewCandidate[] = [
      { position: pos(1, 1), searchScore: 500, scoreExact: true },
      {
        position: pos(2, 2),
        searchScore: 300,
        scoreExact: true,
        opponentForcedWin: "vcf",
      },
    ];
    const views = buildCandidateViews(
      evalWith(candidates, pos(2, 2), pos(1, 1)),
    );
    const label = candidateAriaLabel(views[1]!);
    expect(label).toContain("2位");
    expect(label).toContain("実際の手");
    expect(label).not.toContain("ランク");
    expect(label).toContain("最善比 -200");
    expect(label).toContain("危四追");
  });
});
