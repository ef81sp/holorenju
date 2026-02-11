/**
 * Mise-VCF探索のテスト
 *
 * ミセ手→強制応手→VCF勝ちの探索をテスト
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { checkForbiddenMove, createEmptyBoard } from "@/logic/renjuRules";

import { findMiseVCFMove, findMiseVCFSequence } from "./miseVcf";

describe("findMiseVCFMove", () => {
  it("12手目局面でG7がMise-VCF手として検出される", () => {
    // 12手目までの棋譜（G7の前）
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10",
    );

    // 黒番: G7(row=8, col=6)がMise-VCF手
    const move = findMiseVCFMove(board, "black");
    expect(move).not.toBeNull();
    expect(move?.row).toBe(8);
    expect(move?.col).toBe(6);
  });

  it("Mise-VCFが存在しない局面ではnullを返す", () => {
    // 初手のみの局面: VCFもMise-VCFも存在しない
    const { board } = createBoardFromRecord("H8 I9");

    const move = findMiseVCFMove(board, "black");
    expect(move).toBeNull();
  });

  it("空盤面ではnullを返す", () => {
    const board = createEmptyBoard();

    const move = findMiseVCFMove(board, "black");
    expect(move).toBeNull();
  });
});

describe("findMiseVCFSequence", () => {
  it("12手目局面でG7→J7(防御)後のVCF手順を返す", () => {
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10",
    );

    const result = findMiseVCFSequence(board, "black");
    expect(result).not.toBeNull();

    if (result) {
      // 最初の手はG7
      expect(result.firstMove.row).toBe(8);
      expect(result.firstMove.col).toBe(6);

      // 防御手はJ7(四三点)
      expect(result.defenseMove.row).toBe(8);
      expect(result.defenseMove.col).toBe(9);

      // 手順の長さ: mise + defense + VCF手順
      expect(result.sequence.length).toBeGreaterThanOrEqual(3);

      // 手順の最初の2手はmise手とdefense手
      expect(result.sequence[0]).toEqual(result.miseMove);
      expect(result.sequence[1]).toEqual(result.defenseMove);
    }
  });

  it("Mise-VCFが存在しない局面ではnullを返す", () => {
    const { board } = createBoardFromRecord("H8 I9");

    const result = findMiseVCFSequence(board, "black");
    expect(result).toBeNull();
  });

  it("500ms以内に完了する", () => {
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10",
    );

    const start = performance.now();
    findMiseVCFSequence(board, "black");
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  it("盤面を変更しない（不変性）", () => {
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10",
    );

    // 盤面のスナップショット
    const snapshot = board.map((row) => [...row]);

    findMiseVCFSequence(board, "black");

    // 盤面が変わっていないことを確認
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        expect(board[r]?.[c]).toBe(snapshot[r]?.[c]);
      }
    }
  });
});

describe("黒番のMise-VCF禁手チェック", () => {
  it("三々禁の位置をMise-VCF手として返さない", () => {
    // ベンチマーク#34の棋譜: H6が三々禁かつMise-VCF候補
    // H8 G9 F8 G8 G7 D10 H7 I9 F7 E7 G6 F6 の12手目まで
    const { board } = createBoardFromRecord(
      "H8 G9 F8 G8 G7 D10 H7 I9 F7 E7 G6 F6",
    );

    const move = findMiseVCFMove(board, "black");
    if (move) {
      const forbidden = checkForbiddenMove(board, move.row, move.col);
      expect(forbidden.isForbidden).toBe(false);
    }
  });

  it("白番のMise-VCFは禁手チェックの影響を受けない", () => {
    // 白番ではcheckForbiddenMoveが呼ばれずエラーなく動作する
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10 G7",
    );

    // 白番のMise-VCF探索がエラーなく完了する
    const move = findMiseVCFMove(board, "white");
    // 結果の有無は問わない（エラーなく完了すればOK）
    expect(move === null || move !== null).toBe(true);
  });
});
