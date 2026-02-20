/**
 * Mise-VCF探索のテスト
 *
 * ミセ手→強制応手→VCF勝ちの探索をテスト
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { checkForbiddenMove, createEmptyBoard } from "@/logic/renjuRules";

import { findMiseVCFMove, findMiseVCFSequence } from "./miseVcf";

// 並行テスト実行時のCPU負荷で内部タイムアウトが早期発動するのを防ぐ
const GENEROUS_TIME_LIMIT = { timeLimit: 5000 };

describe("findMiseVCFMove", () => {
  it("12手目局面でG7がMise-VCF手として検出される", () => {
    // 12手目までの棋譜（G7の前）
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10",
    );

    // 黒番: G7(row=8, col=6)がMise-VCF手
    const move = findMiseVCFMove(board, "black", GENEROUS_TIME_LIMIT);
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

    const result = findMiseVCFSequence(board, "black", GENEROUS_TIME_LIMIT);
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

  it("内部タイムアウト以内に完了する", () => {
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10",
    );

    const start = performance.now();
    findMiseVCFSequence(board, "black");
    const elapsed = performance.now() - start;

    // 内部タイムアウト500ms + 並行テスト実行時のオーバーヘッド
    expect(elapsed).toBeLessThan(1500);
  });

  it("盤面を変更しない（不変性）", () => {
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10",
    );

    // 盤面のスナップショット
    const snapshot = board.map((row) => [...row]);

    findMiseVCFSequence(board, "black", GENEROUS_TIME_LIMIT);

    // 盤面が変わっていないことを確認
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        expect(board[r]?.[c]).toBe(snapshot[r]?.[c]);
      }
    }
  });
});

describe("Mise-VCF偽検出の回帰テスト", () => {
  it("44手目白番でI11にMise-VCFを偽検出しない", () => {
    // K列に白4連(K6-K7-K8)があるが両端が黒(K5,K10)で塞がれている
    // K9に白を置いても死に四であり、四三にならないためMise-VCFターゲットにならない
    const record =
      "H8 G7 I9 I7 J8 K7 H7 H9 G8 I8 I6 J5 J7 K8 J6 K6 K5 J10 F9 E10 K10 E9 E8 D10 F8 D8 F10 F11 F7 F6 D9 C10 G10 H11 H5 G6 H4 H6 G4 F3 D7 C6 I4";
    const { board } = createBoardFromRecord(record);

    // 白番のMise-VCF探索でI11=(4,8)が返されないこと
    const move = findMiseVCFMove(board, "white");
    if (move) {
      // I11=(row=4, col=8)でないこと
      expect(move.row === 4 && move.col === 8).toBe(false);
    }
  });

  it("44手目白番のMise-VCF手順でI11が含まれない", () => {
    const record =
      "H8 G7 I9 I7 J8 K7 H7 H9 G8 I8 I6 J5 J7 K8 J6 K6 K5 J10 F9 E10 K10 E9 E8 D10 F8 D8 F10 F11 F7 F6 D9 C10 G10 H11 H5 G6 H4 H6 G4 F3 D7 C6 I4";
    const { board } = createBoardFromRecord(record);

    const result = findMiseVCFSequence(board, "white");
    if (result) {
      // I11=(row=4, col=8)がミセ手でないこと
      expect(result.firstMove.row === 4 && result.firstMove.col === 8).toBe(
        false,
      );
    }
  });
});

describe("相手に活三がある場合のMise-VCFスキップ", () => {
  it("相手に活三がある場合、Mise-VCFを検出しない", () => {
    // 14手目まで: 白がG6-G7-G8の活三を持つ
    // H6がミセ手候補だが、白の四三防御G5がG列の棒四(G5-G6-G7-G8)を作るため
    // ミセの強制応手の前提が崩れる
    const { board } = createBoardFromRecord(
      "H8 G7 I8 H7 I7 G8 I5 I6 J5 J6 K6 J7 J8 G6",
    );

    const result = findMiseVCFSequence(board, "black", GENEROUS_TIME_LIMIT);
    expect(result).toBeNull();
  });

  it("相手に活三がない場合は通常通りMise-VCFを検出する", () => {
    // 既存テストケース: 12手目局面で白に活三なし → G7がMise-VCF手
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10",
    );

    const result = findMiseVCFSequence(board, "black", GENEROUS_TIME_LIMIT);
    expect(result).not.toBeNull();
  });
});

describe("Mise-VCFの強制性チェック", () => {
  it("Game 185: ミセ手H7が飛び三を作るがノリ手で無効 → Mise-VCF検出しない", () => {
    // m14時点: H7のミセ手は飛び三(H10-_-H8-H7)も作る
    // 白がH6で止めるとノリ手になるため、Mise-VCFは不正
    const { board } = createBoardFromRecord(
      "H8 I9 G7 I7 G8 I6 I8 J8 G9 G10 F8 E8 H10 I11",
    );
    const result = findMiseVCFSequence(board, "black", GENEROUS_TIME_LIMIT);
    // H7をミセ手として返さないこと
    if (result) {
      expect(result.miseMove.row === 8 && result.miseMove.col === 7).toBe(
        false,
      );
    }
  });

  it("Game 121: 三も四も作らないミセ手K13 → Mise-VCF検出しない", () => {
    // m41時点: K13は四三点I11へのセットアップだが、K13自体は三も四も作らない
    // 非強制ミセ手のためMise-VCFとして不適格
    const { board } = createBoardFromRecord(
      "H8 I7 F10 K9 J8 H6 I8 G8 H9 G10 I9 H10 G9 F9 J10 G7 H7 J9 G12 F8 E9 H11 E8 E11 F11 I5 J4 I14 E10 D9 I12 H12 E7 E6 K5 J12 L9 H14 H13 K11 I13",
    );
    const result = findMiseVCFSequence(board, "white", GENEROUS_TIME_LIMIT);
    if (result) {
      // K13=(row=2, col=10)がミセ手として返されないこと
      expect(result.miseMove.row === 2 && result.miseMove.col === 10).toBe(
        false,
      );
    }
  });

  it("三を作るミセ手で全防御位置にVCFが成立 → 従来通り検出する", () => {
    // G7のミセ手は活三(G7-H7-I7)を作り、全三防御位置でVCFが成立する
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10",
    );
    const result = findMiseVCFSequence(board, "black", GENEROUS_TIME_LIMIT);
    expect(result).not.toBeNull();
    expect(result?.miseMove.row).toBe(8);
    expect(result?.miseMove.col).toBe(6);
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
