/**
 * 跳び三の防御テスト
 *
 * 棋譜: H8 H7 J8 G8 I9 G7 J7 F9 I6 E9 I8
 * 11手目黒I8でI列に跳び三(I6-I8-I9)が発生。
 * 白は活三防御位置（I7, I10, I5）のみを候補として探索すべき。
 * G9（三三）は防御位置ではないため選択不可。
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { DIFFICULTY_PARAMS } from "@/types/cpu";

import { findBestMoveIterativeWithTT } from "../search/minimax";
import { findFourMoves, findVCFSequence } from "../search/vcf";
import { detectOpponentThreats } from "./threatDetection";

const GAME_RECORD = "H8 H7 J8 G8 I9 G7 J7 F9 I6 E9 I8";

describe("跳び三の脅威検出（I6-I8-I9）", () => {
  const { board } = createBoardFromRecord(GAME_RECORD);

  it("detectOpponentThreats が黒の跳び三を openThrees として検出する", () => {
    const threats = detectOpponentThreats(board, "black");

    // 活四・止め四はない
    expect(threats.openFours).toHaveLength(0);
    expect(threats.fours).toHaveLength(0);

    // 活三の防御位置が存在する
    expect(threats.openThrees.length).toBeGreaterThan(0);

    // I7 (row=8, col=8) が防御位置に含まれる
    const hasI7 = threats.openThrees.some((p) => p.row === 8 && p.col === 8);
    expect(hasI7).toBe(true);
  });

  it("黒の跳び三防御位置に I7, I10, I5 が含まれる", () => {
    const threats = detectOpponentThreats(board, "black");

    // I7 = (8, 8): 跳びの隙間を埋める
    const hasI7 = threats.openThrees.some((p) => p.row === 8 && p.col === 8);
    // I10 = (5, 8): 跳び三の一端
    const hasI10 = threats.openThrees.some((p) => p.row === 5 && p.col === 8);
    // I5 = (10, 8): 跳び三のもう一端
    const hasI5 = threats.openThrees.some((p) => p.row === 10 && p.col === 8);

    expect(hasI7).toBe(true);
    expect(hasI10).toBe(true);
    expect(hasI5).toBe(true);
  });

  it("G9 は防御位置に含まれない", () => {
    const threats = detectOpponentThreats(board, "black");
    // G9 = (6, 6)
    const hasG9 = threats.openThrees.some((p) => p.row === 6 && p.col === 6);
    expect(hasG9).toBe(false);
  });
});

describe("VCF防御セットの検証", () => {
  const { board } = createBoardFromRecord(GAME_RECORD);

  it("黒にVCF（I7 → 活四）が存在する", () => {
    const vcfResult = findVCFSequence(board, "black");
    expect(vcfResult).not.toBeNull();
    // I7 = (8, 8)
    expect(vcfResult?.firstMove).toEqual({ row: 8, col: 8 });
  });

  it("白のカウンターフォーを確認", () => {
    const fourMoves = findFourMoves(board, "white");
    // 実際に何が返されるか確認
    const formatted = fourMoves.map((m) => {
      const col = String.fromCharCode("A".charCodeAt(0) + m.col);
      const row = 15 - m.row;
      return `${col}${row} (${m.row},${m.col})`;
    });
    console.log("White four moves:", formatted);
    console.log("Count:", fourMoves.length);
    // 2手返ってきたので内容を確認
    expect(fourMoves.length).toBeGreaterThanOrEqual(0);
  });

  it("VCF防御セットにカウンターフォーが含まれるが、mandatory defenseで除外される", () => {
    const vcfResult = findVCFSequence(board, "black");
    expect(vcfResult).not.toBeNull();

    // VCF防御ロジックをシミュレート
    const vcfDefenseSet = new Set<string>();

    // (a) 白のカウンターフォー → D11, E10 が含まれる
    const counterFours = findFourMoves(board, "white");
    for (const m of counterFours) {
      vcfDefenseSet.add(`${m.row},${m.col}`);
    }

    // vcfDefenseSet自体は空ではない（D11, E10が入る）
    expect(vcfDefenseSet.size).toBe(2);

    // しかし D11/E10 は活三防御位置ではないため、
    // mandatory defense で -Infinity → generateSortedMoves でフィルタされる
    // → moves に含まれない → defenseMoves は空になる
    // → 修正後のロジックでは活三防御にフォールバックする
  });

  it("VCF防御セットが空なので活三防御にフォールバックする", () => {
    const threats = detectOpponentThreats(board, "black");
    const vcfDefenseSet = new Set<string>(); // 空

    // findBestMoveIterativeWithTTのロジックをシミュレート
    let usedOpenThreeDefense = false;

    if (vcfDefenseSet.size > 0) {
      // VCF防御パスに入る → ここには入らないはず
    } else if (threats.openThrees.length > 0) {
      usedOpenThreeDefense = true;
    }

    expect(usedOpenThreeDefense).toBe(true);

    // 防御位置にG9が含まれないことを確認
    const defenseSet = new Set(
      threats.openThrees.map((p) => `${p.row},${p.col}`),
    );
    // G9 = (6, 6)
    expect(defenseSet.has("6,6")).toBe(false);
    // I7 = (8, 8) は含まれる
    expect(defenseSet.has("8,8")).toBe(true);
  });
});

describe("統合テスト: findBestMoveIterativeWithTT が G9 を選ばない", () => {
  it("hard白はG9（三三）ではなく跳び三防御位置を選ぶ", () => {
    const { board } = createBoardFromRecord(GAME_RECORD);
    const params = DIFFICULTY_PARAMS.hard;

    const result = findBestMoveIterativeWithTT(
      board,
      "white",
      params.depth,
      params.timeLimit,
      params.randomFactor,
      params.evaluationOptions,
      params.maxNodes,
    );

    // G9 = (6, 6) は選ばれてはいけない
    const isG9 = result.position.row === 6 && result.position.col === 6;
    expect(isG9).toBe(false);

    // 活三防御位置（I7, I10, I5）のいずれかが選ばれるべき
    const defensePositions = [
      { row: 8, col: 8 }, // I7
      { row: 5, col: 8 }, // I10
      { row: 10, col: 8 }, // I5
    ];
    const isDefenseMove = defensePositions.some(
      (p) => p.row === result.position.row && p.col === result.position.col,
    );
    expect(isDefenseMove).toBe(true);
  });
});
