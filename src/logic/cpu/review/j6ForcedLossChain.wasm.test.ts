/**
 * #70: J6被詰み検出漏れ修正 + #108敗着チェーン集計との統合確認
 *
 * ボス実戦棋譜 "H8 I9 I8 G8 H7 G6 I7 J6 G7 J7 H6 H9 G5 F4 H4 H5 E7 F7 F6 I3 D8"
 * を review の実際の Phase 1(VCF等)→Phase 2(VCT) 二段階検査（forcedLossCheck.ts /
 * checkForcedLossVCTOnly、#70 修正後の予算）でそのまま評価し、buildEvaluatedMove /
 * applyForcedReplyChains（#108）を通した最終品質ラベルが仕様どおりになることを
 * 確認する。
 *
 * 白の手（moveIndex 1,3,5,7,...19）を実際に検査すると、8手目 J6（moveIndex7）
 * 以降、9,11,13,15,17,19 手目まで全て forcedLossType が付く長いチェーンになる
 * （黒が実際に forcing 手順を続けたため）。仕様上は J6 のみ敗着(blunder)、
 * それ以降は強制応手(forcedReply)として扱われるべき。
 */

import { describe, expect, it } from "vitest";

import type { FullEvalResult } from "@/types/review";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { buildEvaluatedMove, buildGameReview } from "@/logic/reviewLogic";

import { countStones } from "../core/boardUtils";
import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";
import { preloadThreatWasm } from "../wasm/threatAdapter";
import {
  checkForcedLoss,
  checkForcedLossVCTOnly,
  REVIEW_MISE_VCF_OPTIONS,
  REVIEW_VCF_OPTIONS,
} from "./forcedLossCheck";

const engine = new WasmSearchEngine(await loadWasmModule());
await preloadThreatWasm();

const RECORD = "H8 I9 I8 G8 H7 G6 I7 J6 G7 J7 H6 H9 G5 F4 H4 H5 E7 F7 F6 I3 D8";

/** review の実際の Phase 1→Phase 2 二段階検査を1手分再現する */
function evaluateMoveForcedLoss(moveIndex: number): FullEvalResult {
  const moves = RECORD.trim().split(/\s+/);
  const record = moves.slice(0, moveIndex + 1).join(" ");
  const { board } = createBoardFromRecord(record);
  const stoneCount = countStones(board);
  const color: "black" | "white" = moveIndex % 2 === 0 ? "black" : "white";
  const opponentColor = color === "black" ? "white" : "black";

  // Phase 1: VCF/四四/両ミセ/Mise-VCF/三三（VCTはskip）
  const phase1 = checkForcedLoss(board, opponentColor, stoneCount, engine, {
    vcfOptions: REVIEW_VCF_OPTIONS,
    miseVcfOptions: REVIEW_MISE_VCF_OPTIONS,
    vctOptions: {},
    skipVCT: true,
  });

  const loss =
    phase1 ??
    checkForcedLossVCTOnly(board, color, opponentColor, stoneCount, engine);

  return {
    mode: "fullEval",
    moveIndex,
    bestMove: { row: 0, col: 0 },
    bestScore: 0,
    playedScore: 0,
    candidates: [],
    completedDepth: 1,
    forcedLossType: loss?.type,
    forcedLossSequence: loss?.sequence,
  };
}

describe("J6被詰みチェーン: #70(検出) + #108(チェーン集計)の統合", () => {
  it("白の手(moveIndex 1,3,...,19)を実際に検査すると、J6(7)以降が長いforcedLossチェーンになる", () => {
    const whiteMoveIndices = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    const results = whiteMoveIndices.map((i) => evaluateMoveForcedLoss(i));

    const flagged = results
      .filter((r) => r.forcedLossType)
      .map((r) => r.moveIndex);

    // J6(7)以降、この棋譜では黒が forcing 手順を継続したため
    // 9,11,13,15,17,19 全てに forcedLossType が付く
    expect(flagged).toEqual([7, 9, 11, 13, 15, 17, 19]);
  });

  it("J6は敗着(blunder)、9手目以降は強制応手(forcedReply)として最終表示される", () => {
    const whiteMoveIndices = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    const results = whiteMoveIndices.map((i) => evaluateMoveForcedLoss(i));

    // playerFirst=false: 白を isPlayerMove=true として評価する
    const evaluatedMoves = results.map((r) =>
      buildEvaluatedMove(r, RECORD, false),
    );

    const review = buildGameReview(evaluatedMoves);
    const byIndex = (i: number): string | undefined =>
      review.evaluatedMoves.find((m) => m.moveIndex === i)?.quality;

    // moveIndex 1,3,5 は forcedLossType なし → 通常分類（scoreDiff=0→excellent）
    expect(byIndex(1)).toBe("excellent");
    expect(byIndex(3)).toBe("excellent");
    expect(byIndex(5)).toBe("excellent");

    // moveIndex 7 (J6) = チェーン初手 = 敗着として blunder のまま
    expect(byIndex(7)).toBe("blunder");

    // moveIndex 9,11,13,15,17,19 = チェーン継続 = forcedReply に再分類
    for (const i of [9, 11, 13, 15, 17, 19]) {
      expect(byIndex(i)).toBe("forcedReply");
    }

    // criticalErrors はチェーン初手(J6)の1件のみ（forcedReply分は除外）
    expect(review.criticalErrors).toBe(1);
  });
});
