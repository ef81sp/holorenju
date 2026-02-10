// ミセ手問題のデバッグ用テスト
import { describe, expect, it } from "vitest";

import type { StoneColor } from "@/types/game";

import { createEmptyBoard, copyBoard } from "@/logic/renjuRules";

import { evaluatePosition } from "./evaluation";
import { hasVCF, findFourMoves, findVCFMove } from "./search/vcf";

/** セルの値を表示用文字に変換 */
function cellToChar(cell: StoneColor | null): string {
  if (cell === "black") {
    return "● ";
  }
  if (cell === "white") {
    return "○ ";
  }
  return ". ";
}

describe("ミセ手デバッグ", () => {
  it("白が(5,5)に置いた後にVCFがあるか確認", () => {
    const moves = [
      { row: 7, col: 7 },
      { row: 7, col: 6 },
      { row: 8, col: 7 },
      { row: 6, col: 7 },
      { row: 8, col: 8 },
      { row: 8, col: 5 },
      { row: 5, col: 8 },
      { row: 10, col: 3 },
      { row: 9, col: 4 },
      { row: 6, col: 6 },
      { row: 5, col: 6 },
      { row: 6, col: 4 },
      { row: 6, col: 8 },
      { row: 7, col: 8 },
      { row: 5, col: 7 },
    ];

    const board = createEmptyBoard();
    let isBlack = true;
    for (const move of moves) {
      board[move.row][move.col] = isBlack ? "black" : "white";
      isBlack = !isBlack;
    }

    // 盤面表示
    console.log("=== 15手目後の盤面（白の番）===");
    for (let r = 4; r < 11; r++) {
      let row = `${String(r).padStart(2)}: `;
      for (let c = 3; c < 11; c++) {
        const cell = board[r][c];
        row += cellToChar(cell);
      }
      console.log(row);
    }
    console.log("    3 4 5 6 7 8 9 10");

    // 白が(5,5)に置いた後の盤面
    const boardAfter55 = copyBoard(board);
    boardAfter55[5][5] = "white";

    console.log("\n=== 白(5,5)を置いた後 ===");
    for (let r = 4; r < 11; r++) {
      let row = `${String(r).padStart(2)}: `;
      for (let c = 3; c < 11; c++) {
        const cell = boardAfter55[r][c];
        row += cellToChar(cell);
      }
      console.log(row);
    }
    console.log("    3 4 5 6 7 8 9 10");

    // VCFチェック
    const fourMoves = findFourMoves(boardAfter55, "white");
    console.log(
      "\n白の四が作れる位置:",
      fourMoves.map((p) => `(${p.row},${p.col})`).join(", "),
    );

    const vcfMove = findVCFMove(boardAfter55, "white");
    console.log(
      "VCFの最初の手:",
      vcfMove ? `(${vcfMove.row},${vcfMove.col})` : "なし",
    );

    const hasVcf55 = hasVCF(boardAfter55, "white");
    console.log("白(5,5)後にVCFがあるか:", hasVcf55);

    // VCFシーケンスをシミュレート
    if (vcfMove) {
      console.log("\n=== VCFシーケンスのシミュレート ===");
      const board1 = copyBoard(boardAfter55);
      board1[vcfMove.row][vcfMove.col] = "white";
      console.log(`白(${vcfMove.row},${vcfMove.col})後:`);
      for (let r = 4; r < 11; r++) {
        let row = `${String(r).padStart(2)}: `;
        for (let c = 2; c < 11; c++) {
          const cell = board1[r][c];
          row += cellToChar(cell);
        }
        console.log(row);
      }
      console.log("    2 3 4 5 6 7 8 9 10");

      // 黒が止める位置は(6,3)?
      const blackDefense = { row: 6, col: 3 };
      board1[blackDefense.row][blackDefense.col] = "black";
      console.log(`\n黒が(${blackDefense.row},${blackDefense.col})で止めた後:`);
      for (let r = 4; r < 11; r++) {
        let row = `${String(r).padStart(2)}: `;
        for (let c = 2; c < 11; c++) {
          const cell = board1[r][c];
          row += cellToChar(cell);
        }
        console.log(row);
      }
      console.log("    2 3 4 5 6 7 8 9 10");

      const nextFourMoves = findFourMoves(board1, "white");
      console.log(
        "次に白の四が作れる位置:",
        nextFourMoves.map((p) => `(${p.row},${p.col})`).join(", "),
      );

      const hasVcfAfterDefense = hasVCF(board1, "white");
      console.log("黒防御後もVCFがあるか:", hasVcfAfterDefense);

      // 2手目のVCF
      if (nextFourMoves.length > 0) {
        // 白が(7,5)に置いて縦の四を作る
        const board2 = copyBoard(board1);
        board2[7][5] = "white";
        console.log("\n白(7,5)後（縦の四）:");
        for (let r = 4; r < 11; r++) {
          let row = `${String(r).padStart(2)}: `;
          for (let c = 2; c < 11; c++) {
            const cell = board2[r][c];
            row += cellToChar(cell);
          }
          console.log(row);
        }
        console.log("    2 3 4 5 6 7 8 9 10");

        // 縦方向（列5）の状態確認
        console.log("\n縦方向（列5）の状態:");
        for (let r = 3; r < 10; r++) {
          console.log(`(${r},5) = ${board2[r][5] || "空"}`);
        }

        // 黒が(4,5)で止めた場合
        const board3 = copyBoard(board2);
        board3[4][5] = "black";
        console.log("\n黒(4,5)で止めた後:");
        const moreFours = findFourMoves(board3, "white");
        console.log(
          "さらに白の四が作れる位置:",
          moreFours.map((p) => `(${p.row},${p.col})`).join(", "),
        );
        const stillVcf = hasVCF(board3, "white");
        console.log("まだVCFがあるか:", stillVcf);

        // 黒が(9,5)で止めた場合
        const board4 = copyBoard(board2);
        board4[9][5] = "black";
        console.log("\n黒(9,5)で止めた場合:");
        const moreFours2 = findFourMoves(board4, "white");
        console.log(
          "さらに白の四が作れる位置:",
          moreFours2.map((p) => `(${p.row},${p.col})`).join(", "),
        );
        const stillVcf2 = hasVCF(board4, "white");
        console.log("まだVCFがあるか:", stillVcf2);
      }
    }

    // 白が(5,9)に置いた後の盤面
    const boardAfter59 = copyBoard(board);
    boardAfter59[5][9] = "white";

    const hasVcf59 = hasVCF(boardAfter59, "white");
    console.log("白(5,9)後にVCFがあるか:", hasVcf59);

    // hasVCF自体は正しくtrue（その盤面から白が先に動けばVCFで勝てる）
    // 問題は評価関数でのVCFの使い方
    expect(hasVcf55).toBe(true);

    // 評価関数のテスト：白(5,5)は四を作らないのでミセ手防御が適用されるべき
    const evalOptions = {
      enableMandatoryDefense: true,
      enableMise: true,
      enableMiseThreat: true,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
      enableFukumi: true,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
    };

    // 黒のミセ手(5,9)がある状態で、白(5,5)の評価
    const score55 = evaluatePosition(board, 5, 5, "white", evalOptions);
    // 白(5,9)（ミセ手を止める手）の評価
    const score59 = evaluatePosition(board, 5, 9, "white", evalOptions);

    console.log("\n=== 評価関数テスト ===");
    console.log("白(5,5)の評価:", score55);
    console.log("白(5,9)の評価:", score59);

    // 白(5,5)は四を作らないのでフクミ手として認められず、ミセ手防御が適用される
    // → ミセ手を止めない手は-Infinity
    expect(score55).toBe(-Infinity);
    // 白(5,9)はミセ手を止める手なので有効
    expect(score59).toBeGreaterThan(-Infinity);
  });
});
