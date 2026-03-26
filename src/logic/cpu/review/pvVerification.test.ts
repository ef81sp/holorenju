import { describe, expect, it, vi } from "vitest";

import type { BoardState, Position } from "@/types/game";
import type { ReviewCandidate } from "@/types/review";

import { createEmptyBoard } from "@/logic/renjuRules";

import { verifyPV } from "./pvVerification";

// checkCandidateForcedLoss をモック
vi.mock("./forcedLossCheck", () => ({
  checkCandidateForcedLoss: vi.fn(),
  CANDIDATE_VERIFY_VCF_OPTIONS: {},
  CANDIDATE_VERIFY_MISE_VCF_OPTIONS: {},
  CANDIDATE_VERIFY_VCT_OPTIONS: {},
}));

import { checkCandidateForcedLoss } from "./forcedLossCheck";

const mockedCheck = vi.mocked(checkCandidateForcedLoss);

function makeCandidate(pv: Position[]): ReviewCandidate {
  return {
    position: pv[0] ?? { row: 7, col: 7 },
    score: 0,
    searchScore: 0,
    principalVariation: pv,
  } as ReviewCandidate;
}

function pos(row: number, col: number): Position {
  return { row, col };
}

describe("verifyPV", () => {
  const board: BoardState = createEmptyBoard();
  const stoneCount = 0;

  afterEach(() => {
    mockedCheck.mockReset();
  });

  it("PV[0] で VCF 検出 → 'vcf' のまま", () => {
    const pv = [pos(7, 7), pos(7, 8)];
    const candidate = makeCandidate(pv);

    mockedCheck.mockReturnValueOnce({
      type: "vcf",
      sequence: [pos(6, 6)],
    });

    const result = verifyPV(
      board,
      candidate,
      "white",
      "black",
      stoneCount,
      Infinity,
    );

    expect(result).not.toBeNull();
    expect(result!.failIndex).toBe(0);
    expect(result!.forcedLossType).toBe("vcf");
  });

  it("PV[2] で VCF 検出 → 'vct' にダウングレード", () => {
    // PV: [白(0), 黒(1), 白(2), 黒(3)]
    const pv = [pos(7, 7), pos(7, 8), pos(6, 7), pos(6, 8)];
    const candidate = makeCandidate(pv);

    // PV[0] は安全
    mockedCheck.mockReturnValueOnce(undefined);
    // PV[2] で VCF 検出
    mockedCheck.mockReturnValueOnce({
      type: "vcf",
      sequence: [pos(5, 5)],
    });

    const result = verifyPV(
      board,
      candidate,
      "white",
      "black",
      stoneCount,
      Infinity,
    );

    expect(result).not.toBeNull();
    expect(result!.failIndex).toBe(2);
    expect(result!.forcedLossType).toBe("vct");
  });

  it("PV[2] で VCT 検出 → 'vct' のまま", () => {
    const pv = [pos(7, 7), pos(7, 8), pos(6, 7), pos(6, 8)];
    const candidate = makeCandidate(pv);

    mockedCheck.mockReturnValueOnce(undefined);
    mockedCheck.mockReturnValueOnce({
      type: "vct",
      sequence: [pos(5, 5)],
    });

    const result = verifyPV(
      board,
      candidate,
      "white",
      "black",
      stoneCount,
      Infinity,
    );

    expect(result).not.toBeNull();
    expect(result!.failIndex).toBe(2);
    expect(result!.forcedLossType).toBe("vct");
  });

  it("PV[2] で forbidden-trap 検出 → 'forbidden-trap' のまま", () => {
    const pv = [pos(7, 7), pos(7, 8), pos(6, 7), pos(6, 8)];
    const candidate = makeCandidate(pv);

    mockedCheck.mockReturnValueOnce(undefined);
    mockedCheck.mockReturnValueOnce({
      type: "forbidden-trap",
      sequence: [pos(5, 5)],
    });

    const result = verifyPV(
      board,
      candidate,
      "white",
      "black",
      stoneCount,
      Infinity,
    );

    expect(result).not.toBeNull();
    expect(result!.failIndex).toBe(2);
    expect(result!.forcedLossType).toBe("forbidden-trap");
  });

  it("全 PV 安全 → null", () => {
    const pv = [pos(7, 7), pos(7, 8)];
    const candidate = makeCandidate(pv);

    mockedCheck.mockReturnValue(undefined);

    const result = verifyPV(
      board,
      candidate,
      "white",
      "black",
      stoneCount,
      Infinity,
    );
    expect(result).toBeNull();
  });
});
