/**
 * 脅威検出機能のテスト
 *
 * detectOpponentThreats、必須防御ルール、ミセ手防御のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { detectOpponentThreats, evaluatePosition } from "../evaluation";
import { placeStonesOnBoard } from "../testUtils";
import { PATTERN_SCORES } from "./patternScores";

describe("detectOpponentThreats - ミセ手", () => {
  it("次に四三が作れる位置を検出する", () => {
    const board = createEmptyBoard();
    // 横に●●●- (四になる準備)
    // 縦に-●●- (活三になる準備)
    // (7,7)に置くと横に四、縦に活三ができる = 四三
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    const threats = detectOpponentThreats(board, "black");

    expect(threats.mises).toBeDefined();
    expect(threats.mises.length).toBeGreaterThan(0);
    const positions = threats.mises.map((p) => `${p.row},${p.col}`);
    expect(positions).toContain("7,7");
  });
});

describe("detectOpponentThreats - 止め四", () => {
  it("横の止め四を検出する（片端が盤端）", () => {
    const board = createEmptyBoard();
    // x●●●●- (列0,1,2,3に黒石、列4が空き)
    placeStonesOnBoard(board, [
      { row: 7, col: 0, color: "black" },
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
      { row: 7, col: 3, color: "black" },
    ]);

    const threats = detectOpponentThreats(board, "black");

    expect(threats.fours.length).toBe(1);
    expect(threats.fours[0]).toEqual({ row: 7, col: 4 });
  });

  it("横の止め四を検出する（片端が相手石）", () => {
    const board = createEmptyBoard();
    // ○●●●●- (白石で塞がれている)
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const threats = detectOpponentThreats(board, "black");

    expect(threats.fours.length).toBe(1);
    expect(threats.fours[0]).toEqual({ row: 7, col: 8 });
  });
});

describe("detectOpponentThreats", () => {
  it("横の活三を検出する", () => {
    const board = createEmptyBoard();
    // --ooo-- (列4,5,6に黒石)
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const threats = detectOpponentThreats(board, "black");

    expect(threats.openThrees.length).toBeGreaterThan(0);
    // 防御位置は(7,3)と(7,7) - 石に直接隣接
    const positions = threats.openThrees.map((p) => `${p.row},${p.col}`);
    expect(positions).toContain("7,3");
    expect(positions).toContain("7,7");
  });

  it("斜めの活三を検出する", () => {
    const board = createEmptyBoard();
    // 斜め3連: (7,9)-(8,8)-(9,7)
    placeStonesOnBoard(board, [
      { row: 7, col: 9, color: "black" },
      { row: 8, col: 8, color: "black" },
      { row: 9, col: 7, color: "black" },
    ]);

    const threats = detectOpponentThreats(board, "black");

    expect(threats.openThrees.length).toBeGreaterThan(0);
    // 防御位置は(6,10)と(10,6) - 石に直接隣接
    const positions = threats.openThrees.map((p) => `${p.row},${p.col}`);
    expect(positions).toContain("6,10");
    expect(positions).toContain("10,6");
  });

  it("実際の対局盤面で斜め活三を検出する", () => {
    const board = createEmptyBoard();
    // 黒石
    board[7][7] = "black";
    board[8][8] = "black";
    board[9][9] = "black";
    board[9][7] = "black";
    board[7][9] = "black";
    // 白石
    board[8][6] = "white";
    board[5][5] = "white";
    board[10][10] = "white";
    board[9][6] = "white";

    const threats = detectOpponentThreats(board, "black");

    // (7,9)-(8,8)-(9,7)の活三が検出されるべき
    // 防御位置は(6,10)と(10,6)
    expect(threats.openThrees.length).toBeGreaterThan(0);
    const positions = threats.openThrees.map((p) => `${p.row},${p.col}`);
    expect(positions).toContain("6,10");
    expect(positions).toContain("10,6");
  });
});

describe("必須防御ルール", () => {
  const enableMandatoryDefenseOptions = {
    enableFukumi: false,
    enableMise: false,
    enableForbiddenTrap: false,
    enableMultiThreat: false,
    enableCounterFour: false,
    enableVCT: false,
    enableMandatoryDefense: true,
    enableSingleFourPenalty: false,
    singleFourPenaltyMultiplier: 1.0,
    enableMiseThreat: false,
  };

  it("相手の活四を止めない手は-Infinityになる", () => {
    const board = createEmptyBoard();
    // 白の活四: row=7, col=[3,4,5,6] 両端空き
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    // 活四を止める位置 (7,2) または (7,7) 以外は-Infinity
    const nonDefenseScore = evaluatePosition(
      board,
      0,
      0,
      "black",
      enableMandatoryDefenseOptions,
    );
    expect(nonDefenseScore).toBe(-Infinity);

    // 活四を止める位置は有効
    const defenseScore = evaluatePosition(
      board,
      7,
      7,
      "black",
      enableMandatoryDefenseOptions,
    );
    expect(defenseScore).toBeGreaterThan(-Infinity);
  });

  it("相手の活三を止めない手は-Infinityになる", () => {
    const board = createEmptyBoard();
    // 白の活三: row=7, col=[4,5,6] 両端空き
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    // 活三を止める位置 (7,3) または (7,7) 以外は-Infinity
    const nonDefenseScore = evaluatePosition(
      board,
      0,
      0,
      "black",
      enableMandatoryDefenseOptions,
    );
    expect(nonDefenseScore).toBe(-Infinity);

    // 活三を止める位置は有効
    const defenseScore = evaluatePosition(
      board,
      7,
      7,
      "black",
      enableMandatoryDefenseOptions,
    );
    expect(defenseScore).toBeGreaterThan(-Infinity);
  });

  it("自分が四三を作れる場合は防御不要", () => {
    const board = createEmptyBoard();
    // 白の活三がある
    // 黒が四三を作れる配置
    placeStonesOnBoard(board, [
      // 白の活三
      { row: 0, col: 4, color: "white" },
      { row: 0, col: 5, color: "white" },
      { row: 0, col: 6, color: "white" },
      // 黒の四三準備: 横三 + 縦二
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    // (7,7)は四三を作る手なので、防御不要で有効
    const score = evaluatePosition(
      board,
      7,
      7,
      "black",
      enableMandatoryDefenseOptions,
    );
    // 四三を作れるので防御不要、有効な手
    expect(score).toBeGreaterThan(-Infinity);
  });

  it("enableMandatoryDefense=falseなら通常評価", () => {
    const disabledOptions = {
      ...enableMandatoryDefenseOptions,
      enableMandatoryDefense: false,
    };

    const board = createEmptyBoard();
    // 白の活四
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    // 無効時は-Infinityにならない
    const score = evaluatePosition(board, 0, 0, "black", disabledOptions);
    expect(score).toBeGreaterThan(-Infinity);
  });
});

describe("evaluatePosition - 止め四防御", () => {
  const enableMandatoryDefenseOptions = {
    enableFukumi: false,
    enableMise: false,
    enableForbiddenTrap: false,
    enableMultiThreat: false,
    enableCounterFour: false,
    enableVCT: false,
    enableMandatoryDefense: true,
    enableSingleFourPenalty: false,
    singleFourPenaltyMultiplier: 1.0,
    enableMiseThreat: false,
  };

  it("相手の止め四を止めない手は-Infinityを返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 0, color: "black" },
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
      { row: 7, col: 3, color: "black" },
    ]);

    const score = evaluatePosition(
      board,
      10,
      10,
      "white",
      enableMandatoryDefenseOptions,
    );

    expect(score).toBe(-Infinity);
  });

  it("相手の止め四を止める手は有効なスコアを返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 0, color: "black" },
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
      { row: 7, col: 3, color: "black" },
    ]);

    const score = evaluatePosition(
      board,
      7,
      4,
      "white",
      enableMandatoryDefenseOptions,
    );

    expect(score).toBeGreaterThan(-Infinity);
  });
});

describe("evaluatePosition - ミセ手防御", () => {
  const enableMiseThreatOptions = {
    enableFukumi: false,
    enableMise: false,
    enableForbiddenTrap: false,
    enableMultiThreat: false,
    enableCounterFour: false,
    enableVCT: false,
    enableMandatoryDefense: true,
    enableSingleFourPenalty: false,
    singleFourPenaltyMultiplier: 1.0,
    enableMiseThreat: true,
  };

  it("相手のミセ手を止めない手は-Infinityを返す（他の脅威がない場合）", () => {
    const board = createEmptyBoard();
    // 横に-●●- (活三準備、三にならないよう離れた位置)
    // 縦に-●●- (活三準備)
    // (7,7)に置くと横に三、縦に三ができて活三+活三 → 片方が四になる構成が必要
    // 四三になるには一方が「3連の状態から4連」、もう一方が「2連の状態から活三」
    // 横に●●●-, 縦に-●●-
    // ただし横の●●●-が活三になってしまうので止め三にする
    // 止め三にするには片端を塞ぐ
    placeStonesOnBoard(board, [
      // 横: 白で止められた止め三 ○●●●- (7行 col 3=白, 4,5,6=黒)
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      // 縦: -●●- (col 7, row 5,6=黒)
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);
    // (7,7)に置くと横に止め四、縦に活三 → 四三

    const score = evaluatePosition(
      board,
      0,
      0,
      "white",
      enableMiseThreatOptions,
    );

    expect(score).toBe(-Infinity);
  });

  it("相手のミセ手を止める手は有効なスコアを返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    const score = evaluatePosition(
      board,
      7,
      7,
      "white",
      enableMiseThreatOptions,
    );

    expect(score).toBeGreaterThan(-Infinity);
  });
});
