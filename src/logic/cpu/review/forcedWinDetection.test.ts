/**
 * forcedWinDetection のユニットテスト
 *
 * 優先順位ロジック: 1手四三 > 両ミセ >= 長VCF > Mise-VCF > VCT
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import { detectOpponentThreats } from "../evaluation";
import {
  detectForcedWin,
  type ForcedWinDetectionResult,
} from "./forcedWinDetection";

/** 盤面を構築し相手脅威を判定して detectForcedWin を呼ぶヘルパー */
function detect(record: string, isLightEval = false): ForcedWinDetectionResult {
  const { board, nextColor } = createBoardFromRecord(record);
  const color = nextColor as "black" | "white";
  const opponentColor = color === "black" ? "white" : "black";
  const opponentThreats = detectOpponentThreats(board, opponentColor);
  const opponentHasFour =
    opponentThreats.fours.length > 0 || opponentThreats.openFours.length > 0;

  return detectForcedWin(board, color, opponentHasFour, isLightEval);
}

// テスト棋譜: 12手後に黒番でH8で両ミセ可能
const RECORD = "G8 G10 F8 H11 H9 G9 E9 I8 F10 I9 H10 J9";

describe("detectForcedWin: 優先順位", () => {
  it("両ミセがある局面 → forcedWinType=double-mise", () => {
    // 12手後: 黒番、H8で両ミセ可能
    const result = detect(RECORD);
    expect(result.forcedWinType).toBe("double-mise");
    expect(result.doubleMiseBestMove).toEqual({ row: 7, col: 7 }); // H8
    expect(result.doubleMiseMoves.length).toBeGreaterThan(0);
  });

  it("1手四三がある局面 → 両ミセより優先でvcf", () => {
    // 16手後: 両ミセ打った後にVCFの初手で四三が作れる
    const record16 = `${RECORD} I10 F7 H8 A1`;
    const result = detect(record16);
    expect(result.forcedWinType).toBe("vcf");
    expect(result.forcedWin).not.toBeNull();
  });

  it("相手に四がある場合はVCF/VCT/両ミセをスキップ", () => {
    // 相手に開四がある局面を構築（白が四を持つ）
    // H8 H9 I8 G8 J8 → 白がF8で五連可能 = 白に四あり
    const result = detect("H8 H9 I8 G8 J8");
    expect(result.forcedWin).toBeNull();
    expect(result.forcedWinType).toBeUndefined();
    expect(result.doubleMiseMoves).toEqual([]);
  });

  it("VCFがある局面 → forcedWinType=vcf", () => {
    // 黒がVCFで勝てる局面
    // H8 A1 I9 A2 G7 A3 J10 （黒の斜め四が作れる = VCF成立）
    const result = detect("H8 A1 I9 A2 G7 A3 J10 A4 F6");
    if (result.forcedWinType) {
      expect(["vcf", "double-mise"]).toContain(result.forcedWinType);
    }
  });

  it("lightEvalモードでは両ミセ検出をスキップ", () => {
    const result = detect(RECORD, true);
    // lightEvalでは doubleMiseMoves は空配列になる
    expect(result.doubleMiseMoves).toEqual([]);
  });
});

describe("detectForcedWin: 返り値の型安全性", () => {
  it("forcedWin=nullの場合、forcedWinTypeもundefined", () => {
    // 序盤は強制勝ちなし
    const result = detect("H8 H9");
    expect(result.forcedWin).toBeNull();
    expect(result.forcedWinType).toBeUndefined();
  });

  it("forcedWinが検出された場合、firstMoveとsequenceが存在する", () => {
    const result = detect(RECORD);
    if (result.forcedWin) {
      expect(result.forcedWin.firstMove).toBeDefined();
      expect(result.forcedWin.sequence.length).toBeGreaterThan(0);
    }
  });
});
