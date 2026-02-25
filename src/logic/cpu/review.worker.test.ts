/**
 * review.worker の forcedWinType 優先順・missedDoubleMise 判定ロジックのテスト
 *
 * Worker は直接テストできないため、worker 内部と同等のロジックを
 * 関数群の組み合わせで再現して検証する。
 *
 * テスト棋譜: G8 G10 F8 H11 H9 G9 E9 I8 F10 I9 H10 J9 I10 F7 H8 A1 A2
 *   - Move 13 (I10): VCT 開始手。両ミセ(H8)はあるが打っていない
 *   - Move 15 (H8): 両ミセ手を打つ
 *   - Move 17 (A2): 1手四三がある局面で無関係な手
 */

import { describe, expect, it } from "vitest";

import type { Position } from "@/types/game";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import { detectOpponentThreats } from "./evaluation";
import { findMiseTargets } from "./evaluation/miseTactics";
import { findDoubleMiseMoves } from "./evaluation/tactics";
import { createsFourThree } from "./evaluation/winningPatterns";
import { findVCFSequence, type VCFSearchOptions } from "./search/vcf";

const REVIEW_VCF_OPTIONS: VCFSearchOptions = {
  maxDepth: 16,
  timeLimit: 1500,
};

/** テスト棋譜 */
const TEST_RECORD = "G8 G10 F8 H11 H9 G9 E9 I8 F10 I9 H10 J9 I10 F7 H8 A1 A2";

/**
 * worker の forcedWinType 判定ロジックを再現
 */
function determineForcedWinType(
  record: string,
  moveIndex: number,
): {
  forcedWinType: string | undefined;
  doubleMiseBestMove: Position | null;
  isImmediateFourThree: boolean;
  doubleMiseTargets: Position[] | undefined;
} {
  const moves = record.trim().split(/\s+/);
  const { board, nextColor } = createBoardFromRecord(
    moves.slice(0, moveIndex).join(" "),
  );
  const color = nextColor as "black" | "white";
  const opponentColor = color === "black" ? "white" : "black";

  const opponentThreats = detectOpponentThreats(board, opponentColor);
  const opponentHasFour =
    opponentThreats.fours.length > 0 || opponentThreats.openFours.length > 0;

  const doubleMiseMoves = opponentHasFour
    ? []
    : findDoubleMiseMoves(board, color);
  const doubleMiseBestMove =
    doubleMiseMoves.length > 0 ? (doubleMiseMoves[0] ?? null) : null;

  const vcfResult = opponentHasFour
    ? null
    : findVCFSequence(
        board,
        color,
        doubleMiseBestMove
          ? { ...REVIEW_VCF_OPTIONS, maxDepth: 2 }
          : REVIEW_VCF_OPTIONS,
      );

  const isImmediateFourThree = Boolean(
    vcfResult &&
    (vcfResult.sequence.length <= 1 ||
      (doubleMiseBestMove &&
        createsFourThree(
          board,
          vcfResult.firstMove.row,
          vcfResult.firstMove.col,
          color,
        ))),
  );

  let forcedWinType: string | undefined = undefined;
  if (vcfResult?.isForbiddenTrap) {
    forcedWinType = "forbidden-trap";
  } else if (isImmediateFourThree) {
    forcedWinType = "vcf";
  } else if (doubleMiseBestMove) {
    forcedWinType = "double-mise";
  } else if (vcfResult) {
    forcedWinType = "vcf";
  }

  let doubleMiseTargets: Position[] | undefined = undefined;
  if (doubleMiseBestMove) {
    const row = board[doubleMiseBestMove.row];
    if (row) {
      row[doubleMiseBestMove.col] = color;
      doubleMiseTargets = findMiseTargets(
        board,
        doubleMiseBestMove.row,
        doubleMiseBestMove.col,
        color,
      );
      row[doubleMiseBestMove.col] = null;
    }
  }

  return {
    forcedWinType,
    doubleMiseBestMove,
    isImmediateFourThree,
    doubleMiseTargets,
  };
}

/**
 * worker の missedDoubleMise 判定ロジックを再現
 */
function determineMissedDoubleMise(
  record: string,
  moveIndex: number,
): Position[] | undefined {
  const moves = record.trim().split(/\s+/);
  const { board, nextColor } = createBoardFromRecord(
    moves.slice(0, moveIndex).join(" "),
  );
  const color = nextColor as "black" | "white";
  const opponentColor = color === "black" ? "white" : "black";

  const opponentThreats = detectOpponentThreats(board, opponentColor);
  const opponentHasFour =
    opponentThreats.fours.length > 0 || opponentThreats.openFours.length > 0;

  const doubleMiseMoves = opponentHasFour
    ? []
    : findDoubleMiseMoves(board, color);
  const doubleMiseBestMove =
    doubleMiseMoves.length > 0 ? (doubleMiseMoves[0] ?? null) : null;

  const vcfResult = opponentHasFour
    ? null
    : findVCFSequence(
        board,
        color,
        doubleMiseBestMove
          ? { ...REVIEW_VCF_OPTIONS, maxDepth: 2 }
          : REVIEW_VCF_OPTIONS,
      );

  const isImmediateFourThree = Boolean(
    vcfResult &&
    (vcfResult.sequence.length <= 1 ||
      (doubleMiseBestMove &&
        createsFourThree(
          board,
          vcfResult.firstMove.row,
          vcfResult.firstMove.col,
          color,
        ))),
  );

  // forcedWinType 判定
  let forcedWinType: string | undefined = undefined;
  if (vcfResult?.isForbiddenTrap) {
    forcedWinType = "forbidden-trap";
  } else if (isImmediateFourThree) {
    forcedWinType = "vcf";
  } else if (doubleMiseBestMove) {
    forcedWinType = "double-mise";
  } else if (vcfResult) {
    forcedWinType = "vcf";
  }

  // missedDoubleMise 判定
  const playedMoveStr = moves[moveIndex];
  if (!playedMoveStr) {
    return undefined;
  }
  const playedCol = playedMoveStr.charCodeAt(0) - "A".charCodeAt(0);
  const playedRow = 15 - parseInt(playedMoveStr.slice(1), 10);

  if (
    forcedWinType === "double-mise" &&
    doubleMiseMoves.length > 0 &&
    playedRow >= 0
  ) {
    const playedIsDoubleMise = doubleMiseMoves.some(
      (m) => m.row === playedRow && m.col === playedCol,
    );
    if (!playedIsDoubleMise) {
      return doubleMiseMoves;
    }
  }
  return undefined;
}

describe("review.worker: forcedWinType 優先順", () => {
  it("Move 13 (12手後): 両ミセ(H8)がある → forcedWinType=double-mise", () => {
    const result = determineForcedWinType(TEST_RECORD, 12);
    expect(result.forcedWinType).toBe("double-mise");
    expect(result.doubleMiseBestMove).toEqual({ row: 7, col: 7 }); // H8
  });

  it("Move 15 (14手後): 両ミセ(H8)がある → forcedWinType=double-mise", () => {
    const result = determineForcedWinType(TEST_RECORD, 14);
    expect(result.forcedWinType).toBe("double-mise");
  });

  it("Move 17 (16手後): H8の両ミセ後、1手四三がある → forcedWinType=vcf", () => {
    const result = determineForcedWinType(TEST_RECORD, 16);
    expect(result.isImmediateFourThree).toBe(true);
    expect(result.forcedWinType).toBe("vcf");
  });
});

describe("review.worker: missedDoubleMise 判定", () => {
  it("Move 13 (I10): 両ミセを打っていない → missedDoubleMise あり", () => {
    const missed = determineMissedDoubleMise(TEST_RECORD, 12);
    expect(missed).toBeDefined();
    expect(missed?.some((m) => m.row === 7 && m.col === 7)).toBe(true); // H8
  });

  it("Move 15 (H8): 両ミセを打った → missedDoubleMise なし", () => {
    const missed = determineMissedDoubleMise(TEST_RECORD, 14);
    expect(missed).toBeUndefined();
  });

  it("Move 17 (A2): 1手四三局面 → missedDoubleMise なし（VCF優先）", () => {
    const missed = determineMissedDoubleMise(TEST_RECORD, 16);
    expect(missed).toBeUndefined();
  });
});

describe("review.worker: doubleMiseTargets 算出", () => {
  it("Move 13: H8の両ミセターゲットにD8とH6が含まれる", () => {
    const result = determineForcedWinType(TEST_RECORD, 12);
    expect(result.doubleMiseTargets).toBeDefined();
    const targets = result.doubleMiseTargets ?? [];
    // D8 = row 7, col 3
    expect(targets.some((t) => t.row === 7 && t.col === 3)).toBe(true);
    // H6 = row 9, col 7
    expect(targets.some((t) => t.row === 9 && t.col === 7)).toBe(true);
  });
});
