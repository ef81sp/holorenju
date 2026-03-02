/**
 * review.worker のVCT検出パフォーマンステスト
 *
 * CPU集約的なVCT探索を含むため、perf プロジェクト（直列実行）で実行する。
 * ファイル名が *.perf.test.ts のためvitest.config.tsの perf プロジェクトに
 * マッチし、fileParallelism: false + singleFork: true で他テストとの
 * CPU競合を回避する。
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import { countStones } from "./core/boardUtils";
import { detectOpponentThreats } from "./evaluation";
import {
  checkForcedLoss,
  FORCED_LOSS_VCT_OPTIONS,
  REVIEW_MISE_VCF_OPTIONS,
  REVIEW_VCF_OPTIONS,
} from "./review/forcedLossCheck";
import { findVCTSequence } from "./search/vct";

const RECORD_14 = "H8 G7 J10 H10 H9 I9 G8 I10 I8 J8 G11 G10 H7 H6";

describe("H6後の黒VCT検出（診断）", () => {
  it("14手後に白(=自分)が四を持たないこと", () => {
    const { board } = createBoardFromRecord(RECORD_14);
    // color=white (14手目を打った側)
    const selfThreats = detectOpponentThreats(board, "white");
    expect(selfThreats.fours.length).toBe(0);
    expect(selfThreats.openFours.length).toBe(0);
  });

  it("checkForcedLossで黒VCTが検出されること", () => {
    const { board } = createBoardFromRecord(RECORD_14);
    const stoneCount = countStones(board);
    const result = checkForcedLoss(board, "black", stoneCount, {
      vcfOptions: REVIEW_VCF_OPTIONS,
      miseVcfOptions: REVIEW_MISE_VCF_OPTIONS,
      vctOptions: {
        ...FORCED_LOSS_VCT_OPTIONS,
        timeLimit: 20000,
        vcfOptions: { ...FORCED_LOSS_VCT_OPTIONS.vcfOptions, timeLimit: 20000 },
      },
    });
    expect(result).toBeDefined();
    expect(result?.type).toBe("vct");
  });

  it("findVCTSequenceで直接黒VCTを探す", () => {
    const { board } = createBoardFromRecord(RECORD_14);
    const vct = findVCTSequence(board, "black", {
      maxDepth: 6,
      timeLimit: 20000,
      vcfOptions: { maxDepth: 16, timeLimit: 20000 },
      collectBranches: false,
    });
    expect(vct).not.toBeNull();
    // カウンターフォーのブロック手(F10)がシーケンスに含まれ、その後も手順が続くこと
    const f10Idx = vct?.sequence.findIndex((p) => p.row === 5 && p.col === 5);
    expect(f10Idx).toBeGreaterThan(0);
    expect(vct?.sequence.length).toBeGreaterThan((f10Idx ?? 0) + 1);
  });
});

describe("review.worker: skipVCT オプション（VCT検出あり）", () => {
  it("skipVCT: false でVCTが検出されること", () => {
    const { board } = createBoardFromRecord(RECORD_14);
    const stoneCount = countStones(board);
    const result = checkForcedLoss(board, "black", stoneCount, {
      vcfOptions: REVIEW_VCF_OPTIONS,
      miseVcfOptions: REVIEW_MISE_VCF_OPTIONS,
      vctOptions: {
        ...FORCED_LOSS_VCT_OPTIONS,
        timeLimit: 20000,
        vcfOptions: { ...FORCED_LOSS_VCT_OPTIONS.vcfOptions, timeLimit: 20000 },
      },
      skipVCT: false,
    });
    expect(result).toBeDefined();
    expect(result?.type).toBe("vct");
  });
});
