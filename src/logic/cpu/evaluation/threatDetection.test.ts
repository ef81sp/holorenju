/**
 * 脅威検出機能のテスト
 *
 * detectOpponentThreats、必須防御ルール、ミセ手防御のテスト
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

import { detectOpponentThreats, evaluatePosition } from "../evaluation";
import { placeStonesOnBoard } from "../testUtils";
import {
  addUniquePositions,
  getOpenThreeDefensePositions,
  hasDefenseThatBlocksBoth,
} from "./threatDetection";

describe("addUniquePositions", () => {
  it("空配列に複数の位置を追加できる", () => {
    const positions: { row: number; col: number }[] = [];
    const newPositions = [
      { row: 1, col: 2 },
      { row: 3, col: 4 },
    ];

    addUniquePositions(positions, newPositions);

    expect(positions).toHaveLength(2);
    expect(positions).toContainEqual({ row: 1, col: 2 });
    expect(positions).toContainEqual({ row: 3, col: 4 });
  });

  it("重複する位置は追加しない", () => {
    const positions = [{ row: 1, col: 2 }];
    const newPositions = [
      { row: 1, col: 2 }, // 重複
      { row: 3, col: 4 }, // 新規
    ];

    addUniquePositions(positions, newPositions);

    expect(positions).toHaveLength(2);
    expect(positions).toContainEqual({ row: 1, col: 2 });
    expect(positions).toContainEqual({ row: 3, col: 4 });
  });

  it("空の配列を追加しても何も変わらない", () => {
    const positions = [{ row: 1, col: 2 }];

    addUniquePositions(positions, []);

    expect(positions).toHaveLength(1);
  });
});

describe("hasDefenseThatBlocksBoth", () => {
  it("活三とミセ手に共通の防御位置がある場合はtrueを返す", () => {
    const openThrees = [
      { row: 7, col: 7 },
      { row: 7, col: 3 },
    ];
    const mises = [
      { row: 7, col: 7 }, // 共通
      { row: 5, col: 5 },
    ];

    expect(hasDefenseThatBlocksBoth(openThrees, mises)).toBe(true);
  });

  it("活三とミセ手に共通の防御位置がない場合はfalseを返す", () => {
    const openThrees = [
      { row: 7, col: 7 },
      { row: 7, col: 3 },
    ];
    const mises = [
      { row: 5, col: 5 },
      { row: 6, col: 6 },
    ];

    expect(hasDefenseThatBlocksBoth(openThrees, mises)).toBe(false);
  });

  it("空配列の場合はfalseを返す", () => {
    expect(hasDefenseThatBlocksBoth([], [])).toBe(false);
    expect(hasDefenseThatBlocksBoth([{ row: 7, col: 7 }], [])).toBe(false);
    expect(hasDefenseThatBlocksBoth([], [{ row: 7, col: 7 }])).toBe(false);
  });
});

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
    enableDoubleThreeThreat: false,
    enableNullMovePruning: false,
    enableFutilityPruning: false,
    enableForbiddenVulnerability: false,
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

  it("自分が四三を作れる場合は防御不要（相手が活三の場合）", () => {
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

  it("自分が四三を作れても、相手に止め四がある場合は防御必須", () => {
    const board = createEmptyBoard();
    // 白の止め四がある（盤端 x○○○○-）
    // 黒が四三を作れる配置
    placeStonesOnBoard(board, [
      // 白の止め四: 盤端から4連 (row=7に配置して盤端を使う)
      { row: 7, col: 0, color: "white" },
      { row: 7, col: 1, color: "white" },
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "white" },
      // 黒の四三準備: 横止め三（白で塞がれた）+ 縦二
      { row: 10, col: 6, color: "white" }, // 横の止め三を作る
      { row: 10, col: 7, color: "black" },
      { row: 10, col: 8, color: "black" },
      { row: 10, col: 9, color: "black" },
      { row: 8, col: 10, color: "black" },
      { row: 9, col: 10, color: "black" },
    ]);

    // 白の止め四を確認
    const threats = detectOpponentThreats(board, "white");
    expect(threats.fours.length).toBe(1);
    expect(threats.fours[0]).toEqual({ row: 7, col: 4 });

    // (10,10)は止め四+活三を作る手（四三）だが、相手に止め四があるので防御必須
    // 四三でも相手の止め四より先に勝てない
    const fourThreeScore = evaluatePosition(
      board,
      10,
      10,
      "black",
      enableMandatoryDefenseOptions,
    );
    expect(fourThreeScore).toBe(-Infinity);

    // 止め四を防御する手は有効
    const defenseScore = evaluatePosition(
      board,
      7,
      4,
      "black",
      enableMandatoryDefenseOptions,
    );
    expect(defenseScore).toBeGreaterThan(-Infinity);
  });

  it("自分が活四を持っている場合は相手の止め四があっても防御不要", () => {
    const board = createEmptyBoard();
    // 白の止め四がある
    // 黒の活四準備（置くと両端空きの4連になる）
    placeStonesOnBoard(board, [
      // 白の止め四: 盤端から4連
      { row: 0, col: 0, color: "white" },
      { row: 0, col: 1, color: "white" },
      { row: 0, col: 2, color: "white" },
      { row: 0, col: 3, color: "white" },
      // 黒の活四準備: -●●●- (両端空き) - 中央配置
      { row: 10, col: 5, color: "black" },
      { row: 10, col: 6, color: "black" },
      { row: 10, col: 7, color: "black" },
    ]);

    // (10,8)は活四を作る手なので、相手に止め四があっても勝てる
    const openFourScore = evaluatePosition(
      board,
      10,
      8,
      "black",
      enableMandatoryDefenseOptions,
    );
    expect(openFourScore).toBeGreaterThan(-Infinity);
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
    enableDoubleThreeThreat: false,
    enableNullMovePruning: false,
    enableFutilityPruning: false,
    enableForbiddenVulnerability: false,
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

describe("evaluatePosition - 止め四防御（実戦棋譜）", () => {
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
    enableDoubleThreeThreat: false,
    enableNullMovePruning: false,
    enableFutilityPruning: false,
    enableForbiddenVulnerability: false,
  };

  it("黒の止め四があるとき、白は四三を優先せず防御する", () => {
    // 報告されたバグ再現: H8 G7 I7 H6 F8 G9 I8 G8 G6 G10 G11 H7 H10 I6 F9 F7 H9 E7 D7 H11 D8 K4 J5 H12 D10 D9 F10 F12 E12 E9 E6 C8 J8 E10 F11 J7 I5 E11 E8 B7 A6 H4 L8 H5 K8
    // 43手目: 黒L8（止め四）
    // 44手目: 白H5（四三）← バグ: これを選んでしまう
    // 正解: 白は黒の止め四を防御すべき

    const gameRecord =
      "H8 G7 I7 H6 F8 G9 I8 G8 G6 G10 G11 H7 H10 I6 F9 F7 H9 E7 D7 H11 D8 K4 J5 H12 D10 D9 F10 F12 E12 E9 E6 C8 J8 E10 F11 J7 I5 E11 E8 B7 A6 H4 L8";
    const { board } = createBoardFromRecord(gameRecord, 43);

    // 43手目後の盤面で黒の止め四を確認
    const threats = detectOpponentThreats(board, "black");
    expect(threats.fours.length).toBeGreaterThan(0);

    // 防御位置を取得
    const defensePositions = threats.fours.map((p) => formatMove(p));
    console.log("黒の止め四の防御位置:", defensePositions);

    // 白がH5に置くと-Infinity（止め四を止めていない）
    const h5Score = evaluatePosition(
      board,
      10, // H5 = row 10
      7, // H5 = col 7
      "white",
      enableMandatoryDefenseOptions,
    );

    // H5が防御位置でない場合は-Infinity
    const isH5Defense = threats.fours.some((p) => p.row === 10 && p.col === 7);
    if (!isH5Defense) {
      expect(h5Score).toBe(-Infinity);
    }

    // 止め四の防御位置は有効なスコア
    for (const pos of threats.fours) {
      const defenseScore = evaluatePosition(
        board,
        pos.row,
        pos.col,
        "white",
        enableMandatoryDefenseOptions,
      );
      expect(defenseScore).toBeGreaterThan(-Infinity);
    }
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
    enableDoubleThreeThreat: false,
    enableNullMovePruning: false,
    enableFutilityPruning: false,
    enableForbiddenVulnerability: false,
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

describe("getOpenThreeDefensePositions - 夏止め", () => {
  it("片端の beyond に石がある場合、反対側に夏止め位置を返す", () => {
    const board = createEmptyBoard();
    // [blocker](7,2) [EndA空](7,3) ●(7,4) ●(7,5) ●(7,6) [EndB空](7,7) [BeyondB空](7,8)
    placeStonesOnBoard(board, [
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const positions = getOpenThreeDefensePositions(board, 7, 5, 0, 1, "black");

    expect(positions).toContainEqual({ row: 7, col: 3 });
    expect(positions).toContainEqual({ row: 7, col: 7 });
    expect(positions).toContainEqual({ row: 7, col: 8 }); // 夏止め
    expect(positions).toHaveLength(3);
  });

  it("片端が盤端の場合、反対側に夏止め位置を返す", () => {
    const board = createEmptyBoard();
    // [盤端] [EndA空](7,0) ●(7,1) ●(7,2) ●(7,3) [EndB空](7,4) [BeyondB空](7,5)
    placeStonesOnBoard(board, [
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
      { row: 7, col: 3, color: "black" },
    ]);

    const positions = getOpenThreeDefensePositions(board, 7, 2, 0, 1, "black");

    expect(positions).toContainEqual({ row: 7, col: 0 });
    expect(positions).toContainEqual({ row: 7, col: 4 });
    expect(positions).toContainEqual({ row: 7, col: 5 }); // 夏止め
    expect(positions).toHaveLength(3);
  });

  it("両方の beyond が空きの場合、夏止め位置を返さない", () => {
    const board = createEmptyBoard();
    // [BeyondA空](7,2) [EndA空](7,3) ●(7,4) ●(7,5) ●(7,6) [EndB空](7,7) [BeyondB空](7,8)
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const positions = getOpenThreeDefensePositions(board, 7, 5, 0, 1, "black");

    expect(positions).toContainEqual({ row: 7, col: 3 });
    expect(positions).toContainEqual({ row: 7, col: 7 });
    expect(positions).toHaveLength(2);
  });

  it("両方の beyond がブロック → 夏止め済みで脅威なし、空配列を返す", () => {
    const board = createEmptyBoard();
    // [BeyondA石](7,2) [EndA空](7,3) ●(7,4) ●(7,5) ●(7,6) [EndB空](7,7) [BeyondB石](7,8)
    // どちらに伸ばしても止め四にしかならない → 活三の脅威なし
    placeStonesOnBoard(board, [
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    const positions = getOpenThreeDefensePositions(board, 7, 5, 0, 1, "black");

    expect(positions).toHaveLength(0);
  });

  it("斜め方向でも夏止めが正しく検出される", () => {
    const board = createEmptyBoard();
    // (3,3)白ブロッカー, (4,4)EndA空, (5,5)(6,6)(7,7)黒, (8,8)EndB空, (9,9)BeyondB空
    placeStonesOnBoard(board, [
      { row: 3, col: 3, color: "white" },
      { row: 5, col: 5, color: "black" },
      { row: 6, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const positions = getOpenThreeDefensePositions(board, 6, 6, 1, 1, "black");

    expect(positions).toContainEqual({ row: 4, col: 4 });
    expect(positions).toContainEqual({ row: 8, col: 8 });
    expect(positions).toContainEqual({ row: 9, col: 9 }); // 夏止め
    expect(positions).toHaveLength(3);
  });

  it("detectOpponentThreats経由で夏止め位置がopenThreesに含まれる", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const threats = detectOpponentThreats(board, "black");

    const positions = threats.openThrees.map((p) => `${p.row},${p.col}`);
    expect(positions).toContain("7,3");
    expect(positions).toContain("7,7");
    expect(positions).toContain("7,8"); // 夏止め
  });

  it("ユーザ報告ケース: 盤端+活三に対する夏止めが検出される", () => {
    const board = createEmptyBoard();
    // D列縦: D1(row14)=空(盤端), D2(row13)=黒, D3(row12)=黒, D4(row11)=黒,
    //         D5(row10)=空, D6(row9)=空(夏止め位置), D7(row8)=白
    placeStonesOnBoard(board, [
      { row: 13, col: 3, color: "black" },
      { row: 12, col: 3, color: "black" },
      { row: 11, col: 3, color: "black" },
      { row: 8, col: 3, color: "white" },
    ]);

    const positions = getOpenThreeDefensePositions(
      board,
      12,
      3,
      -1,
      0,
      "black",
    );

    // EndA = D5 (row10), EndB = D1 (row14), 夏止め = D6 (row9)
    expect(positions).toContainEqual({ row: 10, col: 3 });
    expect(positions).toContainEqual({ row: 14, col: 3 });
    expect(positions).toContainEqual({ row: 9, col: 3 }); // 夏止め
    expect(positions).toHaveLength(3);
  });

  it("夏止め済みの三はdetectOpponentThreatsで活三として検出されない", () => {
    const board = createEmptyBoard();
    // [BeyondA石](7,2) [EndA空](7,3) ●(7,4) ●(7,5) ●(7,6) [EndB空](7,7) [BeyondB石](7,8)
    placeStonesOnBoard(board, [
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 8, color: "white" },
    ]);

    const threats = detectOpponentThreats(board, "black");

    // 両方の beyond がブロック済み → 活三の脅威なし
    expect(threats.openThrees).toHaveLength(0);
  });
});

describe("detectOpponentThreats - 三三脅威検出", () => {
  it("白が三三を作れる位置がある局面 → doubleThrees に検出", () => {
    const board = createEmptyBoard();
    // 白が(7,8)に置くと横活三+縦活三=三三
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
    ]);

    const threats = detectOpponentThreats(board, "white");

    expect(threats.doubleThrees.length).toBeGreaterThan(0);
    expect(threats.doubleThrees).toContainEqual({ row: 7, col: 8 });
  });

  it("白の脅威がない局面 → doubleThrees が空", () => {
    const board = createEmptyBoard();
    // 白石が1方向のみ
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    const threats = detectOpponentThreats(board, "white");

    expect(threats.doubleThrees).toHaveLength(0);
  });

  it("黒の相手（opponentColor=black）→ doubleThrees 検出しない（黒は三三禁手）", () => {
    const board = createEmptyBoard();
    // 黒が(7,8)に置くと横活三+縦活三=三三 だが黒は三三禁手
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      { row: 6, col: 8, color: "black" },
      { row: 5, col: 8, color: "black" },
    ]);

    const threats = detectOpponentThreats(board, "black");

    expect(threats.doubleThrees).toHaveLength(0);
  });
});

describe("evaluatePosition - 三三脅威防御", () => {
  const enableDoubleThreeThreatOptions = {
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
    enableDoubleThreeThreat: true,
    enableNullMovePruning: false,
    enableFutilityPruning: false,
    enableForbiddenVulnerability: false,
  };

  it("白の三三脅威が1箇所: 阻止しない手 → -Infinity", () => {
    const board = createEmptyBoard();
    // 白が(7,8)に置くと横活三+縦活三=三三
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
    ]);

    // 黒が(0,0)に置く → 三三脅威を阻止していない
    const score = evaluatePosition(
      board,
      0,
      0,
      "black",
      enableDoubleThreeThreatOptions,
    );

    expect(score).toBe(-Infinity);
  });

  it("白の三三脅威が1箇所: 阻止する手 → 正常スコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
    ]);

    // 黒が(7,8)に置く → 三三脅威を阻止
    const score = evaluatePosition(
      board,
      7,
      8,
      "black",
      enableDoubleThreeThreatOptions,
    );

    expect(score).toBeGreaterThan(-Infinity);
  });

  it("白の三三脅威が2箇所以上: 必須防御が発動しない（通常探索に委ねる）", () => {
    const board = createEmptyBoard();
    // 2箇所で三三脅威を作る
    // 脅威1: (7,8)に白を置くと三三
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
    ]);
    // 脅威2: (3,3)に白を置くと三三
    placeStonesOnBoard(board, [
      { row: 3, col: 1, color: "white" },
      { row: 3, col: 2, color: "white" },
      { row: 2, col: 3, color: "white" },
      { row: 1, col: 3, color: "white" },
    ]);

    // 2箇所脅威 → 必須防御不発 → 通常スコア
    const score = evaluatePosition(
      board,
      0,
      0,
      "black",
      enableDoubleThreeThreatOptions,
    );

    expect(score).toBeGreaterThan(-Infinity);
  });

  it("自分が四三を持つ（canWinFirst）→ 三三脅威を無視", () => {
    const board = createEmptyBoard();
    // 白の三三脅威
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
    ]);
    // 黒が(10,10)に置くと四三（横方向に止め四+縦方向に活三）
    placeStonesOnBoard(board, [
      // 横: 止め三 → 四を作る
      { row: 10, col: 7, color: "black" },
      { row: 10, col: 8, color: "black" },
      { row: 10, col: 9, color: "black" },
      // 縦: 活二 → 活三を作る
      { row: 11, col: 10, color: "black" },
      { row: 12, col: 10, color: "black" },
    ]);

    const score = evaluatePosition(
      board,
      10,
      10,
      "black",
      enableDoubleThreeThreatOptions,
    );

    // 四三なので canWinFirst → 三三脅威を無視
    expect(score).toBeGreaterThan(-Infinity);
  });

  it("活三がある場合は三三脅威防御が発動しない", () => {
    const board = createEmptyBoard();
    // 白の三三脅威
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
    ]);
    // 白の活三（三三脅威より優先度が高い）
    placeStonesOnBoard(board, [
      { row: 12, col: 4, color: "white" },
      { row: 12, col: 5, color: "white" },
      { row: 12, col: 6, color: "white" },
    ]);

    // 活三がある → 三三脅威防御は発動しない
    const score = evaluatePosition(
      board,
      0,
      0,
      "black",
      enableDoubleThreeThreatOptions,
    );

    // 活三の必須防御で -Infinity になるはず（三三脅威ではなく活三の防御義務で）
    // ただし (0,0) が活三の防御位置でないため -Infinity
    expect(score).toBe(-Infinity);
  });
});
