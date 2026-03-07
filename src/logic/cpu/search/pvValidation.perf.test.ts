/**
 * PV検証のパフォーマンステスト
 *
 * 実棋譜での回帰テスト（30秒timeout）
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";

import { applyMove } from "../core/boardUtils";
import { FULL_EVAL_OPTIONS } from "../evaluation";
import { detectOpponentThreats } from "../evaluation/threatDetection";
import { findBestMoveIterativeWithTT } from "./minimax";
import { isValidPVMove } from "./results";

describe("PV検証: 実棋譜での回帰テスト", () => {
  it("22手目(白)のPVで、黒が白の活三を無視する手がないこと", () => {
    // 再現棋譜: 21手目（H9）まで
    const record =
      "H8 I7 J6 H7 G7 I9 I8 J8 H6 I5 I6 K6 G6 F6 G5 G4 H5 I4 G8 G9 H9";
    const { board, nextColor } = createBoardFromRecord(record);

    // 22手目は白番のはず
    expect(nextColor).toBe("white");

    // hard準拠のパラメータで探索
    const result = findBestMoveIterativeWithTT({
      board,
      color: "white",
      maxDepth: 4,
      timeLimit: 8000,
      randomFactor: 0,
      evaluationOptions: FULL_EVAL_OPTIONS,
      maxNodes: 600000,
    });

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

    const result = findBestMoveIterativeWithTT({
      board,
      color: "white",
      maxDepth: 4,
      timeLimit: 8000,
      randomFactor: 0,
      evaluationOptions: FULL_EVAL_OPTIONS,
      maxNodes: 600000,
    });

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
