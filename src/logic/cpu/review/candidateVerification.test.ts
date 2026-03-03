import { describe, expect, it } from "vitest";

import type { ReviewCandidate } from "@/types/review";

import { findSafeBest } from "./candidateVerification";

function makeCandidate(
  row: number,
  col: number,
  searchScore: number,
  opponentForcedWin?: string,
): ReviewCandidate {
  return {
    position: { row, col },
    score: searchScore,
    searchScore,
    opponentForcedWin:
      opponentForcedWin as ReviewCandidate["opponentForcedWin"],
  } as ReviewCandidate;
}

describe("findSafeBest", () => {
  it("安全な候補がある場合、最もスコアの高い安全な候補を返す", () => {
    const candidates = [
      makeCandidate(7, 7, 500, "vcf"),
      makeCandidate(7, 8, 300),
      makeCandidate(7, 9, 200),
    ];
    const result = findSafeBest(candidates);
    expect(result?.position).toEqual({ row: 7, col: 8 });
    expect(result?.searchScore).toBe(300);
  });

  it("全候補が危険な場合、undefinedを返す", () => {
    const candidates = [
      makeCandidate(7, 7, 500, "vcf"),
      makeCandidate(7, 8, 300, "vct"),
    ];
    const result = findSafeBest(candidates);
    expect(result).toBeUndefined();
  });

  it("ソート後は安全な候補が先頭に来る", () => {
    const candidates = [
      makeCandidate(7, 7, 500, "vcf"),
      makeCandidate(7, 8, 100),
      makeCandidate(7, 9, 300),
    ];
    findSafeBest(candidates);
    // 安全な候補が先頭にソートされている
    expect(candidates[0]?.opponentForcedWin).toBeUndefined();
    expect(candidates[0]?.searchScore).toBe(300);
  });

  it("空配列ではundefinedを返す", () => {
    expect(findSafeBest([])).toBeUndefined();
  });
});
