/**
 * Game31 禁手負け分析
 * medium(黒) vs beginner(白) で mediumが15手目I9で禁手負け
 *
 * 調査対象: なぜ13手目から探索がスキップされたか
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";
import { checkForbiddenMove, copyBoard } from "@/logic/renjuRules";

import { analyzeDirection } from "./directionAnalysis";
import { detectOpponentThreats } from "./threatDetection";

describe("Game31 禁手負け分析", () => {
  it("12手目後の盤面と脅威検出", () => {
    // 12手目まで: H8 G8 J7 L9 I7 G9 G7 F7 J8 H9 I10 F9
    const record12 = "H8 G8 J7 L9 I7 G9 G7 F7 J8 H9 I10 F9";
    const { board: board12 } = createBoardFromRecord(record12, 12);

    console.log("=== 12手目後の盤面（黒番） ===");
    for (let row = 0; row < 15; row++) {
      let line = `${String(15 - row).padStart(2)}: `;
      for (let col = 0; col < 15; col++) {
        const cell = board12[row]?.[col];
        line += cell === "black" ? "●" : cell === "white" ? "○" : "・";
      }
      console.log(line);
    }
    console.log("    A B C D E F G H I J K L M N O");

    // 白の脅威を検出
    const whiteThreats = detectOpponentThreats(board12, "white");
    console.log("\n=== 白の脅威（黒から見た相手の脅威） ===");
    console.log(
      "活四:",
      whiteThreats.openFours.map((p) => formatMove(p)),
    );
    console.log(
      "止め四:",
      whiteThreats.fours.map((p) => formatMove(p)),
    );
    console.log(
      "活三:",
      whiteThreats.openThrees.map((p) => formatMove(p)),
    );
    console.log(
      "ミセ:",
      whiteThreats.mises.map((p) => formatMove(p)),
    );
  });

  it("13手目後の盤面と脅威検出", () => {
    // 13手目まで: H8 G8 J7 L9 I7 G9 G7 F7 J8 H9 I10 F9 E9
    const record13 = "H8 G8 J7 L9 I7 G9 G7 F7 J8 H9 I10 F9 E9";
    const { board: board13 } = createBoardFromRecord(record13, 13);

    console.log("=== 13手目後の盤面（白番） ===");
    for (let row = 0; row < 15; row++) {
      let line = `${String(15 - row).padStart(2)}: `;
      for (let col = 0; col < 15; col++) {
        const cell = board13[row]?.[col];
        line += cell === "black" ? "●" : cell === "white" ? "○" : "・";
      }
      console.log(line);
    }
    console.log("    A B C D E F G H I J K L M N O");

    // 黒の脅威を検出（白から見た相手の脅威）
    const blackThreats = detectOpponentThreats(board13, "black");
    console.log("\n=== 黒の脅威（白から見た） ===");
    console.log(
      "活四:",
      blackThreats.openFours.map((p) => formatMove(p)),
    );
    console.log(
      "止め四:",
      blackThreats.fours.map((p) => formatMove(p)),
    );
    console.log(
      "活三:",
      blackThreats.openThrees.map((p) => formatMove(p)),
    );

    // 白の脅威を検出（黒から見た）
    const whiteThreats = detectOpponentThreats(board13, "white");
    console.log("\n=== 白の脅威（黒から見た） ===");
    console.log(
      "活四:",
      whiteThreats.openFours.map((p) => formatMove(p)),
    );
    console.log(
      "止め四:",
      whiteThreats.fours.map((p) => formatMove(p)),
    );
    console.log(
      "活三:",
      whiteThreats.openThrees.map((p) => formatMove(p)),
    );

    // E9に黒が置いた後、白がJ9に置くと何が起きるか
    console.log("\n=== 14手目で白がJ9に置いた場合 ===");
    const record14 = "H8 G8 J7 L9 I7 G9 G7 F7 J8 H9 I10 F9 E9 J9";
    const { board: board14 } = createBoardFromRecord(record14, 14);

    // 白の脅威を再検出
    const whiteThreats14 = detectOpponentThreats(board14, "white");
    console.log(
      "白の活四:",
      whiteThreats14.openFours.map((p) => formatMove(p)),
    );
    console.log(
      "白の止め四:",
      whiteThreats14.fours.map((p) => formatMove(p)),
    );

    // I9が禁手かチェック
    const i9Forbidden = checkForbiddenMove(board14, 6, 8);
    console.log("\nI9は禁手か:", i9Forbidden.isForbidden);
    console.log("→ 白の止め四を止める唯一の手I9が禁手 = 禁手追い込み成立");
  });

  it("14手目後の盤面とI9の禁手判定", () => {
    const record = "H8 G8 J7 L9 I7 G9 G7 F7 J8 H9 I10 F9 E9 J9";
    const { board } = createBoardFromRecord(record, 14);

    console.log("=== 14手目後の盤面 ===");
    for (let row = 0; row < 15; row++) {
      let line = `${String(15 - row).padStart(2)}: `;
      for (let col = 0; col < 15; col++) {
        const cell = board[row]?.[col];
        line += cell === "black" ? "●" : cell === "white" ? "○" : "・";
      }
      console.log(line);
    }
    console.log("    A B C D E F G H I J K L M N O");

    // I9 = row=6, col=8
    const forbiddenResult = checkForbiddenMove(board, 6, 8);
    console.log("\n=== I9 (row=6, col=8) の禁手判定 ===");
    console.log("禁手か:", forbiddenResult.isForbidden);
    console.log("タイプ:", forbiddenResult.type);

    // I9に黒を置いた場合の各方向のパターンを確認
    const testBoard = copyBoard(board);
    testBoard[6]![8] = "black";

    console.log("\n=== I9に黒を置いた場合の各方向のパターン ===");
    const directions = [
      { dr: 0, dc: 1, name: "横" },
      { dr: 1, dc: 0, name: "縦" },
      { dr: 1, dc: 1, name: "右下斜め" },
      { dr: 1, dc: -1, name: "右上斜め" },
    ];
    for (const { dr, dc, name } of directions) {
      const pattern = analyzeDirection(testBoard, 6, 8, dr, dc, "black");
      console.log(
        `  ${name}: count=${pattern.count}, end1=${pattern.end1}, end2=${pattern.end2}`,
      );
    }

    // I9に置いた後の盤面表示
    console.log("\n=== I9に黒を置いた後の盤面 ===");
    for (let row = 0; row < 15; row++) {
      let line = `${String(15 - row).padStart(2)}: `;
      for (let col = 0; col < 15; col++) {
        const cell = testBoard[row]?.[col];
        line += cell === "black" ? "●" : cell === "white" ? "○" : "・";
      }
      console.log(line);
    }
    console.log("    A B C D E F G H I J K L M N O");

    // 縦方向の跳び三チェック（I10-I9-空-I7のパターン）
    console.log("\n=== 縦方向(col=8)の石配置 ===");
    for (let row = 4; row <= 10; row++) {
      const cell = testBoard[row]?.[8];
      const coord = `I${15 - row}`;
      console.log(
        `  ${coord} (row=${row}): ${cell === "black" ? "黒" : cell === "white" ? "白" : "空"}`,
      );
    }

    // 黒の有効な手を探す
    console.log("\n=== 黒の有効な手一覧 ===");
    const validMoves: string[] = [];
    const forbiddenMoves: { move: string; type: string }[] = [];
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 15; col++) {
        if (board[row]?.[col] !== null) {
          continue;
        }
        const result = checkForbiddenMove(board, row, col);
        if (!result.isForbidden) {
          validMoves.push(formatMove({ row, col }));
        } else {
          forbiddenMoves.push({
            move: formatMove({ row, col }),
            type: result.type ?? "unknown",
          });
        }
      }
    }
    console.log("有効手数:", validMoves.length);

    console.log("\n=== 禁手の位置 ===");
    for (const fm of forbiddenMoves) {
      console.log(`  ${fm.move}: ${fm.type}`);
    }
  });

  it("14手目後に禁手追い込みが正しく検出される", () => {
    // 14手目まで: H8 G8 J7 L9 I7 G9 G7 F7 J8 H9 I10 F9 E9 J9
    const record14 = "H8 G8 J7 L9 I7 G9 G7 F7 J8 H9 I10 F9 E9 J9";
    const { board } = createBoardFromRecord(record14, 14);

    // 白の脅威を検出
    const whiteThreats = detectOpponentThreats(board, "white");

    // 白の止め四があること
    expect(whiteThreats.fours.length).toBeGreaterThan(0);

    // 防御位置（I9）が禁手であること
    const [defensePos] = whiteThreats.fours;
    expect(defensePos).toBeDefined();
    expect(defensePos!.row).toBe(6); // I9 = row 6
    expect(defensePos!.col).toBe(8); // I9 = col 8

    const forbiddenResult = checkForbiddenMove(
      board,
      defensePos!.row,
      defensePos!.col,
    );
    expect(forbiddenResult.isForbidden).toBe(true);
    expect(forbiddenResult.type).toBe("double-three");

    console.log("✓ 禁手追い込みが正しく検出された");
  });
});
