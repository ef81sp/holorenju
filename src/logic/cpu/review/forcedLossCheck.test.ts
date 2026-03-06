/**
 * forcedLossCheck のユニットテスト
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import {
  checkForcedLoss,
  REVIEW_MISE_VCF_OPTIONS,
  REVIEW_VCF_OPTIONS,
  FORCED_LOSS_VCT_OPTIONS,
} from "./forcedLossCheck";

/**
 * 棋譜 H8 G7 J6 I8 J7 I7 I9 J8 H6 I6 I5 H7 F5 H4 F7 E7 H5 G5 F6 F4 G8 E4 G4 E5
 *
 * 19手目 F6（黒）後の盤面。黒は F5-F6-F7 の活三を持っており、
 * 白の三三は成立しない。
 */
const RECORD_19 = "H8 G7 J6 I8 J7 I7 I9 J8 H6 I6 I5 H7 F5 H4 F7 E7 H5 G5 F6";

describe("checkForcedLoss: 三三のカウンター脅威フィルタ", () => {
  it("防御側に活三がある場合、三三を強制負けと報告しない", () => {
    const { board } = createBoardFromRecord(RECORD_19);
    const result = checkForcedLoss(board, "white", 19, {
      vcfOptions: REVIEW_VCF_OPTIONS,
      miseVcfOptions: REVIEW_MISE_VCF_OPTIONS,
      vctOptions: FORCED_LOSS_VCT_OPTIONS,
      skipVCT: true,
    });
    // 白の三三があっても、黒に活三があるため強制負けではない
    expect(result?.type).not.toBe("double-three");
  });

  it("防御側に活三がなく三三が成立する場合、double-three を報告する", () => {
    // 白石: G9, H9, I8, I7 → I9で横(G9-H9-I9)＋縦(I7-I8-I9)の三三
    // 黒石: H8, A1, A2, A3, A4 → カウンター脅威なし
    const record = "H8 G9 A1 H9 A2 I8 A3 I7 A4";
    const { board } = createBoardFromRecord(record);
    const result = checkForcedLoss(board, "white", 9, {
      vcfOptions: REVIEW_VCF_OPTIONS,
      miseVcfOptions: REVIEW_MISE_VCF_OPTIONS,
      vctOptions: FORCED_LOSS_VCT_OPTIONS,
      skipVCT: true,
    });
    expect(result?.type).toBe("double-three");
  });

  it("白の三三手が黒の活三をブロックする場合、double-three を報告する", () => {
    // 黒石: I8, I7, I9 → 縦の活三(I7-I8-I9)
    // 白石: G10, H10, J11, K12 → I10で横(G10-H10-I10)＋斜め(I10-J11-K12)の三三
    // I10は同時に黒の活三(I7-I8-I9)の上端をブロック
    const record = "I8 G10 I7 H10 I9 J11 A1 K12 A2";
    const { board } = createBoardFromRecord(record);
    const result = checkForcedLoss(board, "white", 9, {
      vcfOptions: REVIEW_VCF_OPTIONS,
      miseVcfOptions: REVIEW_MISE_VCF_OPTIONS,
      vctOptions: FORCED_LOSS_VCT_OPTIONS,
      skipVCT: true,
    });
    expect(result?.type).toBe("double-three");
  });
});
