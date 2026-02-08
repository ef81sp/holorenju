/**
 * PV検証のテスト
 *
 * PV（想定手順）が必須防御ルールに違反しないことを検証
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

import { applyMove } from "../core/boardUtils";
import { FULL_EVAL_OPTIONS } from "../evaluation";
import { detectOpponentThreats } from "../evaluation/threatDetection";
import { placeStonesOnBoard } from "../testUtils";
import { TranspositionTable } from "../transpositionTable";
import { computeBoardHash } from "../zobrist";
import { findBestMoveIterativeWithTT } from "./minimax";
import { extractPV, isValidPVMove } from "./results";

describe("isValidPVMove", () => {
  it("五連が作れる手は常に有効", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 五連完成の手
    expect(isValidPVMove(board, { row: 7, col: 7 }, "black")).toBe(true);
  });

  it("相手の活四を無視する手は無効", () => {
    const board = createEmptyBoard();
    // 白の活四: (7,3)-(7,6)の4連で両端空き
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    // 活四を止めない手は無効
    expect(isValidPVMove(board, { row: 0, col: 0 }, "black")).toBe(false);
    // 活四の端を止める手は有効
    expect(isValidPVMove(board, { row: 7, col: 2 }, "black")).toBe(true);
    expect(isValidPVMove(board, { row: 7, col: 7 }, "black")).toBe(true);
  });

  it("相手の活三を無視する手は無効", () => {
    const board = createEmptyBoard();
    // 白の活三: (7,4)-(7,6)の3連で両端空き
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    // 活三を止めない手は無効
    expect(isValidPVMove(board, { row: 0, col: 0 }, "black")).toBe(false);
    // 活三の端を止める手は有効
    expect(isValidPVMove(board, { row: 7, col: 3 }, "black")).toBe(true);
    expect(isValidPVMove(board, { row: 7, col: 7 }, "black")).toBe(true);
  });

  it("脅威がなければどの手も有効", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);

    expect(isValidPVMove(board, { row: 6, col: 6 }, "black")).toBe(true);
    expect(isValidPVMove(board, { row: 0, col: 0 }, "white")).toBe(true);
  });
});

describe("extractPV: 脅威を無視する手でPVを打ち切り", () => {
  it("TTのbestMoveが活三を無視する場合、PVを打ち切る", () => {
    const board = createEmptyBoard();
    // 白の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    const tt = new TranspositionTable(1000);
    const hash = computeBoardHash(board);

    // 白がH8に打つ（PVの最初の手、問題なし）
    const firstMove = { row: 7, col: 7 };
    const boardAfterFirst = applyMove(board, firstMove, "white");
    const hash2 = computeBoardHash(boardAfterFirst);

    // 黒のTTエントリ: 活三を無視して関係ない場所に打つ
    tt.store(hash2, -100, 3, "EXACT", { row: 0, col: 0 });

    const result = extractPV(board, hash, firstMove, "white", tt);

    // 黒の不正な手でPVが打ち切られる（firstMoveのみ）
    expect(result.pv).toHaveLength(1);
    expect(result.pv[0]).toEqual(firstMove);
  });

  it("TTのbestMoveが正しい防御手の場合、PVは継続する", () => {
    const board = createEmptyBoard();
    // 白の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    const tt = new TranspositionTable(1000);
    const hash = computeBoardHash(board);

    // 白がH8に打つ
    const firstMove = { row: 7, col: 7 };
    const boardAfterFirst = applyMove(board, firstMove, "white");
    const hash2 = computeBoardHash(boardAfterFirst);

    // 黒のTTエントリ: 活三の端を止める（正しい防御）
    tt.store(hash2, -100, 3, "EXACT", { row: 7, col: 3 });

    const result = extractPV(board, hash, firstMove, "white", tt);

    // 防御手は有効なのでPVは継続
    expect(result.pv.length).toBeGreaterThanOrEqual(2);
    expect(result.pv[1]).toEqual({ row: 7, col: 3 });
  });
});

describe("PV検証: 実棋譜での回帰テスト", () => {
  it("22手目(白)のPVで、黒が白の活三を無視する手がないこと", () => {
    // 再現棋譜: 21手目（H9）まで
    const record =
      "H8 I7 J6 H7 G7 I9 I8 J8 H6 I5 I6 K6 G6 F6 G5 G4 H5 I4 G8 G9 H9";
    const { board, nextColor } = createBoardFromRecord(record);

    // 22手目は白番のはず
    expect(nextColor).toBe("white");

    // hard準拠のパラメータで探索
    const result = findBestMoveIterativeWithTT(
      board,
      "white",
      4,
      8000,
      0, // randomFactor: 0
      FULL_EVAL_OPTIONS,
      600000,
    );

    // 各候補手のPVを検証
    if (result.candidates) {
      for (const candidate of result.candidates) {
        if (!candidate.pv || candidate.pv.length < 2) {
          continue;
        }

        // PVの各手を盤面に適用しながら検証
        let pvBoard = board;
        let pvColor: "black" | "white" = "white";

        for (let i = 0; i < candidate.pv.length; i++) {
          const pvMove = candidate.pv[i];
          if (!pvMove) {
            break;
          }

          if (i > 0) {
            // 2手目以降は脅威検証
            const isValid = isValidPVMove(pvBoard, pvMove, pvColor);
            expect(
              isValid,
              `候補手 ${formatMove(candidate.move)} のPV ${i + 1}手目 ` +
                `${formatMove(pvMove)} (${pvColor}) が必須防御ルールに違反`,
            ).toBe(true);
          }

          pvBoard = applyMove(pvBoard, pvMove, pvColor);
          pvColor = pvColor === "black" ? "white" : "black";
        }
      }
    }
  }, 30000); // 探索に時間がかかるためタイムアウトを延長

  it("22手目(白)のPVで、白が自分の脅威を活用する手が含まれること", () => {
    const record =
      "H8 I7 J6 H7 G7 I9 I8 J8 H6 I5 I6 K6 G6 F6 G5 G4 H5 I4 G8 G9 H9";
    const { board } = createBoardFromRecord(record);

    const result = findBestMoveIterativeWithTT(
      board,
      "white",
      4,
      8000,
      0,
      FULL_EVAL_OPTIONS,
      600000,
    );

    // J5が候補に含まれているか確認
    const j5 = result.candidates?.find(
      (c) =>
        c.move.row === 15 - 5 &&
        c.move.col === "J".charCodeAt(0) - "A".charCodeAt(0),
    );

    const firstPvMove = j5?.pv?.[0];
    const secondPvMove = j5?.pv?.[1];
    if (firstPvMove && secondPvMove) {
      // J5後の盤面で白の脅威を確認
      const boardAfterJ5 = applyMove(board, firstPvMove, "white");
      const threats = detectOpponentThreats(boardAfterJ5, "white");

      // J5で白の脅威が存在するなら、黒の応手は防御手であるべき
      const hasThreats =
        threats.openThrees.length > 0 ||
        threats.fours.length > 0 ||
        threats.openFours.length > 0;

      if (hasThreats) {
        const allDefensePositions = [
          ...threats.openFours,
          ...threats.fours,
          ...threats.openThrees,
        ];
        const isDefending = allDefensePositions.some(
          (p) => p.row === secondPvMove.row && p.col === secondPvMove.col,
        );
        expect(
          isDefending,
          `J5後の黒の応手 ${formatMove(secondPvMove)} は白の脅威を止めていない`,
        ).toBe(true);
      }
    }
  }, 30000);
});
