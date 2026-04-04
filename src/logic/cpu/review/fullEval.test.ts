/**
 * fullEval の統合テスト
 *
 * Issue #5: 追い詰めより被三々が優先されていて敗着表示も出てしまう
 */

import { describe, expect, it } from "vitest";

import { executeFullEval } from "./fullEval";

const ISSUE_5_RECORD =
  "H8 G8 H9 F7 G9 E10 I9 F9 H7 H10 I7 F10 K9 J9 H6 H5 J8 G5 L10";

describe("Issue #5: 追い詰め継続時に被三々を抑制", () => {
  it("11手目(I7): 黒が追い詰め継続中なら forcedLossType を付けない", () => {
    const result = executeFullEval({
      moveHistory: ISSUE_5_RECORD,
      moveIndex: 10, // 0-indexed: 11手目 = I7
    });
    // 黒は追い詰め（VCT/VCF）を持っており、I7はその継続手
    // 白の三三（F10）は黒の連続脅威により実行不能
    expect(result.forcedLossType).toBeUndefined();
  });

  it("11手目(I7): 打った候補手の opponentForcedWin もクリアされる", () => {
    const result = executeFullEval({
      moveHistory: ISSUE_5_RECORD,
      moveIndex: 10,
    });
    // I7 = row 8, col 8
    const playedCand = result.candidates.find(
      (c) => c.position.row === 8 && c.position.col === 8,
    );
    // 追い詰め継続手なので弱い被脅威（三三）は候補からもクリア
    expect(playedCand?.opponentForcedWin).toBeUndefined();
  });
});
