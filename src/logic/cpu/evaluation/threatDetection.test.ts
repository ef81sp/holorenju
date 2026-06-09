/**
 * 脅威検出機能のテスト
 *
 * detectOpponentThreats、防御位置検出、複数方向脅威の分類整合性のテスト。
 * （必須防御ルール・ミセ手防御・三三脅威防御の評価挙動は対局Zig化に伴い
 *  position_eval.zig へ移管し、そちらの zig test で検証する。）
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { detectOpponentThreats } from "../evaluation";
import { placeStonesOnBoard } from "../testUtils";
import {
  addUniquePositions,
  countThreatDirections,
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

describe("detectOpponentThreats - 跳び四と活三の判別", () => {
  it("跳び四の連続三部分を活三として検出しない", () => {
    const board = createEmptyBoard();
    // 跳び四パターン: ●●●_● (列H: row4-row7-row8-row9)
    // H11(row4)-[gap H10(row5)]-H9(row6)-H8(row7)-H7(row8)
    // ※座標系: row=14-行番号 → H7=row8, H8=row7, H9=row6, H10=row5, H11=row4
    placeStonesOnBoard(board, [
      { row: 8, col: 7, color: "black" }, // H7
      { row: 7, col: 7, color: "black" }, // H8
      { row: 6, col: 7, color: "black" }, // H9
      // gap at row 5 (H10)
      { row: 4, col: 7, color: "black" }, // H11
    ]);

    const threats = detectOpponentThreats(board, "black");

    // 跳び四として検出される
    expect(threats.fours.length).toBeGreaterThan(0);
    const hasH10 = threats.fours.some((p) => p.row === 5 && p.col === 7);
    expect(hasH10).toBe(true);

    // H7-H8-H9 を活三として検出しない（跳び四の一部）
    expect(threats.openThrees).toHaveLength(0);
  });

  it("独立した連続三は正しく活三として検出される", () => {
    const board = createEmptyBoard();
    // 独立した活三: ●●● 両端空き（跳び四ではない）
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const threats = detectOpponentThreats(board, "black");

    // 活三として検出される
    expect(threats.openThrees.length).toBeGreaterThan(0);
  });
});

describe("countThreatDirections - 跳び四と活三の分類整合性", () => {
  it("跳び四 + 別方向の活三 → 脅威方向数=2（二重カウントなし）", () => {
    const board = createEmptyBoard();
    // 横方向: E8-F8-G8-[gap H8]-I8 = 跳び四
    // 縦方向: G7-G8-G9 = 活三
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" }, // E8
      { row: 7, col: 5, color: "black" }, // F8
      { row: 7, col: 6, color: "black" }, // G8
      // gap at col 7 (H8)
      { row: 7, col: 8, color: "black" }, // I8
      { row: 8, col: 6, color: "black" }, // G7
      { row: 6, col: 6, color: "black" }, // G9
    ]);

    // G8 から見て横=跳び四(+1)、縦=活三(+1) → 計2
    const count = countThreatDirections(board, 7, 6, "black");
    expect(count).toBe(2);
  });

  it("跳び四でない連続活三 → 活三としてカウント", () => {
    const board = createEmptyBoard();
    // ●●● 横方向: F8-G8-H8（両端空き）
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" }, // F8
      { row: 7, col: 6, color: "black" }, // G8
      { row: 7, col: 7, color: "black" }, // H8
    ]);

    const count = countThreatDirections(board, 7, 6, "black");
    expect(count).toBe(1);
  });

  it("黒のウソの三かつ跳び四 → 跳び四としてカウント", () => {
    const board = createEmptyBoard();
    // 横方向: E8-F8-G8-[gap H8]-I8 = 跳び四
    // E8-F8-G8 は両端空きの連続三だが:
    //   D8 への達四は D列の縦石で四四（禁手）
    //   H8 への達四は五連（四ではない）
    //   → ウソの三
    // しかし跳び四としてはカウントされるべき
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" }, // E8
      { row: 7, col: 5, color: "black" }, // F8
      { row: 7, col: 6, color: "black" }, // G8
      // gap at col 7 (H8)
      { row: 7, col: 8, color: "black" }, // I8
      // D列の縦石（D8に達四すると四四=禁手）
      { row: 9, col: 3, color: "black" }, // D6
      { row: 8, col: 3, color: "black" }, // D7
      { row: 6, col: 3, color: "black" }, // D9
    ]);

    // G8 から見て横方向は跳び四 → カウントされる
    const count = countThreatDirections(board, 7, 6, "black");
    expect(count).toBe(1);
  });
});
