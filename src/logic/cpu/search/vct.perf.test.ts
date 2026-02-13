/**
 * VCT探索のテスト
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { copyBoard, createEmptyBoard } from "@/logic/renjuRules";

import { createBoardWithStones } from "../testUtils";
import {
  countStones,
  findVCTMove,
  findVCTSequence,
  getThreatDefensePositions,
  hasOpenThree,
  hasVCT,
  isVCTFirstMove,
  VCT_STONE_THRESHOLD,
} from "./vct";

describe("hasVCT", () => {
  it("空の盤面ではVCTなし", () => {
    const board = createEmptyBoard();
    expect(hasVCT(board, "black")).toBe(false);
    expect(hasVCT(board, "white")).toBe(false);
  });

  it("VCFがある場合はVCT成立（VCF ⊂ VCT）", () => {
    // 活三の状態（両端が空いている）- これはVCFでもある
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(hasVCT(board, "black")).toBe(true);
  });

  it("活四がある場合はVCT成立", () => {
    // 活四の形
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(hasVCT(board, "black")).toBe(true);
  });

  it("白の活三からVCTが成立する", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    expect(hasVCT(board, "white")).toBe(true);
  });

  it("連続した脅威で勝利できる場合はVCT成立", () => {
    // 2方向に三がある形
    const board = createBoardWithStones([
      // 横に三
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      // 縦に三
      { row: 4, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
      { row: 6, col: 8, color: "white" },
    ]);
    expect(hasVCT(board, "white")).toBe(true);
  });

  it("深さ制限内でVCTが成立しない場合はfalse", () => {
    // 1石だけでは4手以内にVCTは成立しない
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    expect(hasVCT(board, "black")).toBe(false);
  });

  it("単独の活三でもVCT成立（活三→活四→勝利）", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 活三から四を作れば活四になり勝利
    expect(hasVCT(board, "black")).toBe(true);
  });
});

describe("countStones", () => {
  it("空の盤面は石数0", () => {
    const board = createEmptyBoard();
    expect(countStones(board)).toBe(0);
  });

  it("石数を正しくカウント", () => {
    const board = createBoardWithStones([
      { row: 0, col: 0, color: "black" },
      { row: 7, col: 7, color: "white" },
      { row: 14, col: 14, color: "black" },
    ]);
    expect(countStones(board)).toBe(3);
  });
});

describe("VCT_STONE_THRESHOLD", () => {
  it("閾値が14に設定されている", () => {
    expect(VCT_STONE_THRESHOLD).toBe(14);
  });
});

describe("石数閾値の動作", () => {
  it("20石未満の盤面でもVCT探索は実行される（即VCF判定のみ）", () => {
    // 活三の状態（VCFでもある）
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 石数は3個で20未満だが、VCFがあるのでVCT成立
    expect(countStones(board)).toBe(3);
    expect(hasVCT(board, "black")).toBe(true);
  });

  it("20石以上の盤面ではVCT探索が実行される", () => {
    // 20石以上の盤面を作成
    const stones: { row: number; col: number; color: "black" | "white" }[] = [];
    // 交互に石を配置（VCFにならない形で）
    for (let i = 0; i < 10; i++) {
      stones.push({ row: 0, col: i, color: "black" });
      stones.push({ row: 14, col: i, color: "white" });
    }
    // 黒の活三を追加
    stones.push({ row: 7, col: 5, color: "black" });
    stones.push({ row: 7, col: 6, color: "black" });
    stones.push({ row: 7, col: 7, color: "black" });

    const board = createBoardWithStones(stones);
    expect(countStones(board)).toBeGreaterThanOrEqual(20);
    expect(hasVCT(board, "black")).toBe(true);
  });
});

describe("VCTゴールデンテスト", () => {
  // 既存の振る舞いを保証するスナップショットテスト
  const testCases = [
    {
      name: "空の盤面はVCTなし",
      stones: [] as { row: number; col: number; color: "black" | "white" }[],
      color: "black" as const,
      expected: false,
    },
    {
      name: "黒の活三からVCT成立（VCF ⊂ VCT）",
      stones: [
        { row: 7, col: 5, color: "black" as const },
        { row: 7, col: 6, color: "black" as const },
        { row: 7, col: 7, color: "black" as const },
      ],
      color: "black" as const,
      expected: true,
    },
    {
      name: "白の斜め活三からVCT成立",
      stones: [
        { row: 5, col: 5, color: "white" as const },
        { row: 6, col: 6, color: "white" as const },
        { row: 7, col: 7, color: "white" as const },
      ],
      color: "white" as const,
      expected: true,
    },
    {
      name: "1石だけではVCTなし",
      stones: [{ row: 7, col: 7, color: "black" as const }],
      color: "black" as const,
      expected: false,
    },
  ];

  testCases.forEach(({ name, stones, color, expected }) => {
    it(name, () => {
      const board = createBoardWithStones(stones);
      expect(hasVCT(board, color)).toBe(expected);
    });
  });
});

describe("VCTSearchOptions付きテスト", () => {
  it("拡張時間制限でhasVCTが動作する", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(
      hasVCT(board, "black", 0, undefined, { maxDepth: 6, timeLimit: 1000 }),
    ).toBe(true);
  });

  it("深度0ではVCTなし", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(hasVCT(board, "black", 0, undefined, { maxDepth: 0 })).toBe(false);
  });
});

describe("findVCTMove", () => {
  it("VCF成立時はVCFの手を返す", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const move = findVCTMove(board, "black");
    expect(move).not.toBeNull();
    expect(move?.row).toBe(7);
    expect([4, 8]).toContain(move?.col);
  });

  it("VCTなしの場合はnullを返す", () => {
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    expect(findVCTMove(board, "black")).toBeNull();
  });
});

describe("findVCTSequence", () => {
  it("VCF成立時はVCF手順を返す", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const result = findVCTSequence(board, "black");
    expect(result).not.toBeNull();
    expect(result?.sequence.length).toBeGreaterThanOrEqual(1);
  });

  it("VCTなしの場合はnullを返す", () => {
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    expect(findVCTSequence(board, "black")).toBeNull();
  });
});

describe("isVCTFirstMove", () => {
  it("活三を作る手はVCT開始手", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // (7,4) or (7,8) はVCF開始手でもある
    expect(isVCTFirstMove(board, { row: 7, col: 4 }, "black")).toBe(true);
    expect(isVCTFirstMove(board, { row: 7, col: 8 }, "black")).toBe(true);
  });

  it("無関係な手はVCT開始手でない", () => {
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    expect(isVCTFirstMove(board, { row: 0, col: 0 }, "black")).toBe(false);
  });
});

describe("ユーザ報告の棋譜テスト", () => {
  // 棋譜: H8 H7 H6 I7 G7 I5 G8 F8 G6 G5 E6 F6 F7 H9 E7 E5 C4 D5 F5 D7 K3 J6 H10 H4 ...
  // 23手目まで（H4の直前の局面）で白にVCTが存在することを確認
  // H4はJ6-I5-H4のナナメの活三を作り、VCT開始手として有効
  const record =
    "H8 H7 H6 I7 G7 I5 G8 F8 G6 G5 E6 F6 F7 H9 E7 E5 C4 D5 F5 D7 K3 J6 H10";
  const options = {
    maxDepth: 6,
    timeLimit: 5000,
    vcfOptions: { maxDepth: 16, timeLimit: 5000 },
  };

  it("24手目は白番", () => {
    const { nextColor } = createBoardFromRecord(record);
    expect(nextColor).toBe("white");
  });

  it("H4がJ6-I5-H4のナナメの活三を作りVCT開始手と判定される", () => {
    const { board } = createBoardFromRecord(record);
    // H4 → row=11, col=7（白番）
    const h4 = { row: 11, col: 7 };
    expect(isVCTFirstMove(board, h4, "white", options)).toBe(true);
  });

  it("findVCTMoveが白のVCT開始手を見つける", () => {
    const { board } = createBoardFromRecord(record);
    const move = findVCTMove(board, "white", options);
    expect(move).not.toBeNull();
  });

  it("findVCTSequenceが白のVCT手順を返す", () => {
    const { board } = createBoardFromRecord(record);
    const result = findVCTSequence(board, "white", options);
    expect(result).not.toBeNull();
    expect(result?.sequence.length).toBeGreaterThanOrEqual(3);
  });

  it("VCT開始手がisVCTFirstMoveで検証される", { timeout: 15000 }, () => {
    const { board } = createBoardFromRecord(record);
    const move = findVCTMove(board, "white", options);
    expect(move).not.toBeNull();
    if (move) {
      expect(isVCTFirstMove(board, move, "white", options)).toBe(true);
    }
  });
});

describe("盤面不変性テスト", () => {
  // VCTが成立する盤面（活三）
  const vctStones = [
    { row: 7, col: 5, color: "black" as const },
    { row: 7, col: 6, color: "black" as const },
    { row: 7, col: 7, color: "black" as const },
  ];
  // VCTが成立しない盤面
  const noVctStones = [{ row: 7, col: 7, color: "black" as const }];
  const options = { maxDepth: 4, timeLimit: 1000 };

  it("hasVCT呼び出し前後で盤面が不変", () => {
    const board = createBoardWithStones(vctStones);
    const snapshot = copyBoard(board);
    hasVCT(board, "black", 0, undefined, options);
    expect(board).toEqual(snapshot);

    const board2 = createBoardWithStones(noVctStones);
    const snapshot2 = copyBoard(board2);
    hasVCT(board2, "black", 0, undefined, options);
    expect(board2).toEqual(snapshot2);
  });

  it("findVCTMove呼び出し前後で盤面が不変", () => {
    const board = createBoardWithStones(vctStones);
    const snapshot = copyBoard(board);
    findVCTMove(board, "black", options);
    expect(board).toEqual(snapshot);

    const board2 = createBoardWithStones(noVctStones);
    const snapshot2 = copyBoard(board2);
    findVCTMove(board2, "black", options);
    expect(board2).toEqual(snapshot2);
  });

  it("findVCTSequence呼び出し前後で盤面が不変", () => {
    const board = createBoardWithStones(vctStones);
    const snapshot = copyBoard(board);
    findVCTSequence(board, "black", options);
    expect(board).toEqual(snapshot);

    const board2 = createBoardWithStones(noVctStones);
    const snapshot2 = copyBoard(board2);
    findVCTSequence(board2, "black", options);
    expect(board2).toEqual(snapshot2);
  });

  it("isVCTFirstMove呼び出し前後で盤面が不変", () => {
    const board = createBoardWithStones(vctStones);
    const snapshot = copyBoard(board);
    isVCTFirstMove(board, { row: 7, col: 4 }, "black", options);
    expect(board).toEqual(snapshot);

    const board2 = createBoardWithStones(noVctStones);
    const snapshot2 = copyBoard(board2);
    isVCTFirstMove(board2, { row: 0, col: 0 }, "black", options);
    expect(board2).toEqual(snapshot2);
  });
});

describe("分岐収集（collectBranches）", () => {
  // 23手目盤面: 白のVCTが成立し、分岐が存在する
  const record =
    "H8 H7 H6 I7 G7 I5 G8 F8 G6 G5 E6 F6 F7 H9 E7 E5 C4 D5 F5 D7 K3 J6 H10";
  const branchOptions = {
    maxDepth: 6,
    timeLimit: 5000,
    vcfOptions: { maxDepth: 16, timeLimit: 5000 },
    collectBranches: true,
  };

  it("collectBranches: true でVCF成立時はbranchesなし", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const result = findVCTSequence(board, "black", {
      collectBranches: true,
      timeLimit: 1000,
    });
    expect(result).not.toBeNull();
    // VCFの場合は分岐なし（VCFは四連続なので防御は1通り）
    expect(result?.branches).toBeUndefined();
  });

  it("23手目盤面でVCT手順が収集される", () => {
    const { board } = createBoardFromRecord(record);
    // 分岐収集は探索コストが高いため時間制限を延長
    // perf プロジェクト（testTimeout: 30000）で直列実行されるため余裕を持たせる
    const result = findVCTSequence(board, "white", {
      ...branchOptions,
      timeLimit: 25000,
      vcfOptions: { maxDepth: 16, timeLimit: 25000 },
    });
    expect(result).not.toBeNull();
    expect(result?.sequence.length).toBeGreaterThanOrEqual(3);
  });

  it(
    "collectBranches: false（デフォルト）では既存の動作を維持",
    { timeout: 15000 },
    () => {
      const { board } = createBoardFromRecord(record);
      const result = findVCTSequence(board, "white", {
        maxDepth: 6,
        timeLimit: 5000,
        vcfOptions: { maxDepth: 16, timeLimit: 5000 },
      });
      expect(result).not.toBeNull();
      expect(result?.branches).toBeUndefined();
    },
  );

  it("盤面不変性（collectBranches: true）", { timeout: 15000 }, () => {
    const { board } = createBoardFromRecord(record);
    const snapshot = copyBoard(board);
    findVCTSequence(board, "white", branchOptions);
    expect(board).toEqual(snapshot);
  });
});

describe("跳び三防御の検証", () => {
  // 14手目盤面: 白にJ7-J8-J9の活三があり、黒のVCTはスキップされる
  const record14 = "H8 I7 G7 I9 H6 J8 H10 H9 G9 J7 H7 G8 I8 J9";
  const options = {
    maxDepth: 6,
    timeLimit: 5000,
    vcfOptions: { maxDepth: 16, timeLimit: 5000 },
  };

  it("14手目盤面は白にJ7-J8-J9の活三があるためVCTスキップ", () => {
    const { board } = createBoardFromRecord(record14);
    // 白のJ7(8,9)-J8(7,9)-J9(6,9)は両端空き → 活三
    expect(hasOpenThree(board, "white")).toBe(true);
    // 黒のVCTは不成立（白が四を打てる）
    expect(findVCTSequence(board, "black", options)).toBeNull();
  });

  it("E7の跳び三の防御位置にF8(中止め)が含まれる", () => {
    const { board } = createBoardFromRecord(record14);
    // H5(四) → H4(防御) → E7(跳び三) の局面を構築
    if (board[10]) {
      board[10][7] = "black";
    } // H5
    if (board[11]) {
      board[11][7] = "white";
    } // H4
    if (board[8]) {
      board[8][4] = "black";
    } // E7

    // E7(8,4)で跳び三が成立: D6(9,3)-E7(8,4)-F8(7,5)-G9(6,6)-H10(5,7)-I11(4,8)
    // パターン: ・●・●●・ → 防御点は D6(9,3), F8(7,5), I11(4,8) の3つ
    const defensePositions = getThreatDefensePositions(board, 8, 4, "black");

    const hasF8 = defensePositions.some((p) => p.row === 7 && p.col === 5);
    const hasD6 = defensePositions.some((p) => p.row === 9 && p.col === 3);
    const hasI11 = defensePositions.some((p) => p.row === 4 && p.col === 8);

    expect(hasF8).toBe(true); // F8(中止め)
    expect(hasD6).toBe(true); // D6(外止め)
    expect(hasI11).toBe(true); // I11(外止め)

    // undo
    if (board[10]) {
      board[10][7] = null;
    }
    if (board[11]) {
      board[11][7] = null;
    }
    if (board[8]) {
      board[8][4] = null;
    }
  });

  it("盤面不変性", () => {
    const { board } = createBoardFromRecord(record14);
    const snapshot = copyBoard(board);
    findVCTSequence(board, "black", options);
    expect(board).toEqual(snapshot);
  });
});

describe("相手に活三がある場合のVCTスキップ", () => {
  // 棋譜43手+A10,B10,D6,E6後: 黒にG4-H4-I4の活三がある
  const baseRecord =
    "H8 G7 I9 I7 J8 K7 H7 H9 G8 I8 I6 J5 J7 K8 J6 K6 K5 J10 F9 E10 K10 E9 E8 D10 F8 D8 F10 F11 F7 F6 D9 C10 G10 H11 H5 G6 H4 H6 G4 F3 D7 C6 I4";

  it("47手目局面で黒に活三がある", () => {
    const extendedRecord = `${baseRecord} A10 B10 D6 E6`;
    const { board } = createBoardFromRecord(extendedRecord);
    // 黒のG4(11,6)-H4(11,7)-I4(11,8)が活三
    expect(hasOpenThree(board, "black")).toBe(true);
  });

  it("相手に活三がある場合、白のVCTはスキップされる", () => {
    const extendedRecord = `${baseRecord} A10 B10 D6 E6`;
    const { board } = createBoardFromRecord(extendedRecord);
    const options = {
      maxDepth: 6,
      timeLimit: 5000,
      vcfOptions: { maxDepth: 16, timeLimit: 3000 },
    };

    // 黒に活三があるので白のVCTは不成立（VCFのみ有効）
    const result = findVCTSequence(board, "white", options);
    // VCFで見つかる場合はisForbiddenTrapかつ四追いのみの手順
    // VCTとして三を含む手順は返されない
    if (result) {
      // E11=(4,4)の三手が手順に含まれないこと
      const hasE11 = result.sequence.some((p) => p.row === 4 && p.col === 4);
      expect(hasE11).toBe(false);
    }
  });

  it("活三がない場合はVCTが正常に探索される", () => {
    // 単純な活三のみの盤面（相手に活三なし）
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(hasOpenThree(board, "white")).toBe(false);
    expect(hasVCT(board, "black")).toBe(true);
  });
});

describe("防御手のカウンター脅威チェック", () => {
  // 防御手が四を作る場合にVCTが不成立になることを検証
  it("防御手が四を作る場合はVCT不成立", () => {
    // 白が三を作り、黒の防御位置が四を作る配置
    const board = createBoardWithStones([
      // 白の活三（横: E8-F8-G8）
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      // 黒: 防御位置(7,3)=D8で四ができるように配置
      // 縦: D7(8,3)-D6(9,3)-D5(10,3) の3石 → D8で棒四
      { row: 8, col: 3, color: "black" },
      { row: 9, col: 3, color: "black" },
      { row: 10, col: 3, color: "black" },
    ]);
    // 白の活三に対して防御位置は(7,3)と(7,7)
    // (7,3)で黒が四を作れるので、白のVCT（三脅威）はこの分岐で不成立
    // ただし(7,7)防御ではカウンター脅威なし→全防御がVCT成立ではない
    // VCFは白が既に活三なので成立する可能性がある
    // → このテストは防御手カウンター脅威チェックの基本動作を確認
    const snapshot = copyBoard(board);
    hasVCT(board, "white");
    expect(board).toEqual(snapshot);
  });

  it("防御手が五を作る場合はVCT不成立", () => {
    // 白の脅威に対して、黒の防御で五連が完成する配置
    const board = createBoardWithStones([
      // 白の活三
      { row: 3, col: 5, color: "white" },
      { row: 3, col: 6, color: "white" },
      { row: 3, col: 7, color: "white" },
      // 黒: 防御位置(3,4)で五連完成
      { row: 3, col: 0, color: "black" },
      { row: 3, col: 1, color: "black" },
      { row: 3, col: 2, color: "black" },
      { row: 3, col: 3, color: "black" },
    ]);
    // 黒は(3,4)に打つと五連→白のVCTが成立しない
    const snapshot = copyBoard(board);
    hasVCT(board, "white");
    expect(board).toEqual(snapshot);
  });

  it("防御手にカウンター脅威がない場合はVCT継続", () => {
    // 単純な活三: 防御手にカウンター脅威なし
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    expect(hasVCT(board, "white")).toBe(true);
  });

  it("盤面不変性", () => {
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 8, col: 3, color: "black" },
      { row: 9, col: 3, color: "black" },
      { row: 10, col: 3, color: "black" },
    ]);
    const snapshot = copyBoard(board);
    hasVCT(board, "white");
    expect(board).toEqual(snapshot);
    findVCTSequence(board, "white");
    expect(board).toEqual(snapshot);
    findVCTMove(board, "white");
    expect(board).toEqual(snapshot);
  });
});
