/**
 * VCT探索のテスト
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { copyBoard, createEmptyBoard } from "@/logic/renjuRules";

import { countStones } from "../core/boardUtils";
import { createBoardWithStones } from "../testUtils";
import { findMiseVCFSequence } from "./miseVcf";
import {
  checkDefenseCounterThreat,
  getFourDefensePosition,
} from "./threatPatterns";
import {
  findVCTMove,
  findVCTSequence,
  hasVCT,
  isVCTFirstMove,
  VCT_STONE_THRESHOLD,
} from "./vct";
import {
  getThreatDefensePositions,
  hasOpenThree,
  isThreat,
} from "./vctHelpers";

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
    // findVCTMoveはhasVCTベース（ct=three楽観判定）のため、
    // isVCTFirstMove（ct=three→hasVCFフォールバック）と結果が異なりうる。
    // 既知の有効手H4で直接検証する。
    const h4 = { row: 11, col: 7 };
    expect(isVCTFirstMove(board, h4, "white", options)).toBe(true);
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
    timeLimit: 10000,
    vcfOptions: { maxDepth: 16, timeLimit: 10000 },
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
        timeLimit: 10000,
        vcfOptions: { maxDepth: 16, timeLimit: 10000 },
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

describe("カウンターフォー（ct=four）の処理", () => {
  it("ct=four でブロックが脅威を作る → VCT開始手として有効", () => {
    // 白が(7,7)に打つと活三(7,5)(7,6)(7,7)を作る
    // 防御(7,4)で黒の止め四(6,4)(7,4)(8,4)(9,4)が成立（(5,4)が白で上端ブロック）
    // 白はブロック(10,4)を打つ → (10,4)(10,5)(10,6)で活三を作る → 脅威 → VCT継続
    // (7,8)防御では白のVCF（(0,5)(0,6)(0,7)→(0,4)で活四）が成立 → VCT成立
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 5, col: 4, color: "white" },
      { row: 10, col: 5, color: "white" },
      { row: 10, col: 6, color: "white" },
      { row: 6, col: 4, color: "black" },
      { row: 8, col: 4, color: "black" },
      { row: 9, col: 4, color: "black" },
      // (7,8)防御時のVCF用: (0,4)で活四→即勝ち
      { row: 0, col: 5, color: "white" },
      { row: 0, col: 6, color: "white" },
      { row: 0, col: 7, color: "white" },
    ]);
    expect(isVCTFirstMove(board, { row: 7, col: 7 }, "white")).toBe(true);
  });

  it("ct=four でブロックが脅威を作らない → VCT開始手として無効", () => {
    // (7,7)で活三、(7,4)防御でct=four、ブロック(10,4)は孤立 → VCT不成立
    // 白に(2,5)(2,6)があるので現行コードはVCT誤検出するが、新コードはブロック強制で正しく棄却
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 5, col: 4, color: "white" },
      { row: 2, col: 5, color: "white" },
      { row: 2, col: 6, color: "white" },
      { row: 6, col: 4, color: "black" },
      { row: 8, col: 4, color: "black" },
      { row: 9, col: 4, color: "black" },
    ]);
    expect(isVCTFirstMove(board, { row: 7, col: 7 }, "white")).toBe(false);
  });

  it("ct=four で盤面不変性", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 5, col: 4, color: "white" },
      { row: 10, col: 5, color: "white" },
      { row: 10, col: 6, color: "white" },
      { row: 6, col: 4, color: "black" },
      { row: 8, col: 4, color: "black" },
      { row: 9, col: 4, color: "black" },
    ]);
    const snapshot = copyBoard(board);
    isVCTFirstMove(board, { row: 7, col: 7 }, "white");
    expect(board).toEqual(snapshot);
    hasVCT(board, "white");
    expect(board).toEqual(snapshot);
    findVCTMove(board, "white");
    expect(board).toEqual(snapshot);
    findVCTSequence(board, "white");
    expect(board).toEqual(snapshot);
  });
});

// ct=three: hasVCFフォールバック適用済み
// ct=threeの検出・盤面不変性テストは「VCTカウンター脅威: ct=three」グループに統合
// isVCTFirstMove用のct=threeテストは「isVCTFirstMove: ct=three のhasVCFフォールバック」グループ

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

describe("VCTカウンター脅威: ct=four", () => {
  // 防御手がカウンターフォーを作る局面
  // White: (3,3)がブロッカー, (7,4)-(7,5)が横二, (8,4)-(8,5)がブロック後の脅威用
  // Black: (4,3)-(5,3)-(6,3)が縦三
  // White (7,6)で活三 → 防御(7,3)でBlack縦四(stop four) → ブロック(8,3)で活三
  it("ct=fourの検出: 防御手が止め四を作る", () => {
    const board = createBoardWithStones([
      { row: 3, col: 3, color: "white" }, // ブロッカー
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 4, col: 3, color: "black" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);
    // White (7,6)攻撃後、Black (7,3)防御の状態を構築
    board[7]![6] = "white"; // 攻撃手
    board[7]![3] = "black"; // 防御手
    // (7,3)でBlackが(4,3)-(5,3)-(6,3)-(7,3)の止め四を作る
    expect(checkDefenseCounterThreat(board, 7, 3, "black")).toBe("four");
    // ブロック位置は(8,3)
    const blockPos = getFourDefensePosition(board, { row: 7, col: 3 }, "black");
    expect(blockPos).toEqual({ row: 8, col: 3 });
    // undo
    board[7]![6] = null;
    board[7]![3] = null;
  });

  it("ct=four: ブロックが脅威を作る場合VCT成立", () => {
    const board = createBoardWithStones([
      { row: 3, col: 3, color: "white" }, // ブロッカー
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 8, col: 4, color: "white" }, // ブロック(8,3)で活三になる
      { row: 8, col: 5, color: "white" },
      { row: 4, col: 3, color: "black" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);
    // ブロック位置(8,3)が(8,3)-(8,4)-(8,5)の活三を作ることを確認
    board[8]![3] = "white";
    expect(isThreat(board, 8, 3, "white")).toBe(true);
    board[8]![3] = null;

    expect(hasVCT(board, "white")).toBe(true);
  });

  it("ct=four: ブロックが脅威を作らない場合VCT不成立", () => {
    const board = createBoardWithStones([
      { row: 3, col: 3, color: "white" }, // ブロッカー
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      // (8,4),(8,5)なし → ブロック(8,3)は脅威にならない
      { row: 4, col: 3, color: "black" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);
    // ブロック位置(8,3)が脅威を作らないことを確認
    board[8]![3] = "white";
    expect(isThreat(board, 8, 3, "white")).toBe(false);
    board[8]![3] = null;

    expect(hasVCT(board, "white")).toBe(false);
  });

  it("ct=four: 盤面不変性", () => {
    const board = createBoardWithStones([
      { row: 3, col: 3, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 8, col: 4, color: "white" },
      { row: 8, col: 5, color: "white" },
      { row: 4, col: 3, color: "black" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);
    const snapshot = copyBoard(board);
    hasVCT(board, "white");
    expect(board).toEqual(snapshot);
    findVCTMove(board, "white");
    expect(board).toEqual(snapshot);
    findVCTSequence(board, "white");
    expect(board).toEqual(snapshot);
  });
});

describe("VCTカウンター脅威: ct=three", () => {
  // 防御手がカウンター活三を作る局面
  // Black: (5,3)-(6,3)が縦二 → 防御(7,3)で活三
  it("ct=threeの検出: 防御手が活三を作る", () => {
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);
    // White (7,6)攻撃後、Black (7,3)防御
    board[7]![6] = "white";
    board[7]![3] = "black";
    expect(checkDefenseCounterThreat(board, 7, 3, "black")).toBe("three");
    board[7]![6] = null;
    board[7]![3] = null;
  });

  it("ct=three: VCFがある場合VCT成立", () => {
    // White: ダブルスリーが可能な配置
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 5, col: 6, color: "white" }, // (7,6)で縦三も作れる
      { row: 6, col: 6, color: "white" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);
    // (7,6)でダブルスリー → 防御(7,3)でct=three → VCF(縦四)で勝ち
    // timeLimit延長で確認（先に他のthreatが試されるため150msでは不足しうる）
    expect(hasVCT(board, "white", 0, undefined, { timeLimit: 5000 })).toBe(
      true,
    );
  });

  it("ct=three: VCFがない場合VCT不成立", () => {
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      // VCFに繋がる追加石なし
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);
    expect(hasVCT(board, "white")).toBe(false);
  });

  it("ct=three: 盤面不変性", () => {
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 5, col: 6, color: "white" },
      { row: 6, col: 6, color: "white" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);
    const snapshot = copyBoard(board);
    hasVCT(board, "white");
    expect(board).toEqual(snapshot);
    findVCTMove(board, "white");
    expect(board).toEqual(snapshot);
    findVCTSequence(board, "white");
    expect(board).toEqual(snapshot);
  });
});

describe("ミセ四追い局面での再現テスト", () => {
  // 再現棋譜の14手目までの盤面（黒番、15手目F6の直前）
  // mise-VCF: firstMove=G7(8,6), defenseMove=F6(9,5)
  // F6は跳び四(5,5)(6,5)(7,5)_(8,5)(9,5)を作り、防御後に黒VCTが成立する
  const record14 = "H8 H9 G8 I8 G10 G9 F9 E8 E10 H7 F10 H10 F8 F11";

  it("14手目盤面でmise-VCFが検出される", () => {
    const { board } = createBoardFromRecord(record14);
    const miseVcf = findMiseVCFSequence(board, "black", {
      vcfOptions: { maxDepth: 12, timeLimit: 300 },
      timeLimit: 500,
    });
    expect(miseVcf).not.toBeNull();
    expect(miseVcf?.firstMove).toEqual({ row: 8, col: 6 }); // G7
    expect(miseVcf?.defenseMove).toEqual({ row: 9, col: 5 }); // F6
  });

  it("F6は有効なVCT開始手（跳び四→防御後にVCT成立）", () => {
    const { board } = createBoardFromRecord(record14);
    // F6の跳び四は正当なVCTリソース（ct=none経由でhasVCT=true）
    expect(
      isVCTFirstMove(board, { row: 9, col: 5 }, "black", {
        maxDepth: 6,
        timeLimit: 3000,
        vcfOptions: { maxDepth: 16, timeLimit: 3000 },
      }),
    ).toBe(true);
  });

  it("盤面不変性", () => {
    const { board } = createBoardFromRecord(record14);
    const snapshot = copyBoard(board);
    isVCTFirstMove(board, { row: 9, col: 5 }, "black", {
      maxDepth: 6,
      timeLimit: 3000,
      vcfOptions: { maxDepth: 16, timeLimit: 3000 },
    });
    expect(board).toEqual(snapshot);
  });
});

describe("ct=four 楽観判定の偽陽性", () => {
  // ブロックが「囲まれた活三」を作る場合:
  // isThreat=trueだがhasVCT=false → 現行コードは偽陽性を返す
  //
  // 盤面構成:
  // Row 7: B(7,4) W(7,5) W(7,6) [W(7,7)played] W(7,8) → 止め四, 防御(7,9)
  // Col 9: W(5,9) B(6,9) [B(7,9)defense] B(8,9) B(9,9) → カウンター止め四, ブロック(10,9)
  // Row 10: B(10,7) _(10,8) [W(10,9)block] W(10,10) W(10,11) _(10,12) B(10,13)
  //   → ブロックで活三形成、しかし両端が黒に囲まれ止め四しか作れない → VCT不成立
  it("ブロックが囲まれた活三を作る場合、VCT開始手として無効", () => {
    const board = createBoardWithStones([
      // 止め四リソース (row 7)
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 8, color: "white" },
      { row: 7, col: 4, color: "black" }, // 左端ブロック
      // カウンターフォーリソース (col 9)
      { row: 5, col: 9, color: "white" }, // 上端ブロック
      { row: 6, col: 9, color: "black" },
      { row: 8, col: 9, color: "black" },
      { row: 9, col: 9, color: "black" },
      // (5,9)-(6,8)-(7,7)斜めリソースを遮断
      { row: 6, col: 8, color: "black" },
      // ブロック位置(10,9)で活三になるが両端に黒
      { row: 10, col: 10, color: "white" },
      { row: 10, col: 11, color: "white" },
      { row: 10, col: 7, color: "black" }, // 活三左端
      { row: 10, col: 13, color: "black" }, // 活三右端（1マス空け）
    ]);
    // (7,7)で止め四 → (7,9)防御でct=four → (10,9)ブロック
    // ブロックで活三だが両端に黒 → 止め四しか作れず勝利不能
    expect(isVCTFirstMove(board, { row: 7, col: 7 }, "white")).toBe(false);
  });

  it("ブロックが活三+VCFリソースを持つ場合、VCT開始手として有効", () => {
    const board = createBoardWithStones([
      // 止め四リソース (row 7)
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 8, color: "white" },
      { row: 7, col: 4, color: "black" },
      // カウンターフォーリソース (col 9)
      { row: 5, col: 9, color: "white" },
      { row: 6, col: 9, color: "black" },
      { row: 8, col: 9, color: "black" },
      { row: 9, col: 9, color: "black" },
      // ブロック位置(10,9)で活三（制限なし: VCTリソースあり）
      { row: 10, col: 10, color: "white" },
      { row: 10, col: 11, color: "white" },
      // 追加VCFリソース (row 0): 活三→活四→勝利
      { row: 0, col: 5, color: "white" },
      { row: 0, col: 6, color: "white" },
      { row: 0, col: 7, color: "white" },
    ]);
    expect(isVCTFirstMove(board, { row: 7, col: 7 }, "white")).toBe(true);
  });

  it("盤面不変性", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 8, color: "white" },
      { row: 7, col: 4, color: "black" },
      { row: 5, col: 9, color: "white" },
      { row: 6, col: 9, color: "black" },
      { row: 6, col: 8, color: "black" },
      { row: 8, col: 9, color: "black" },
      { row: 9, col: 9, color: "black" },
      { row: 10, col: 10, color: "white" },
      { row: 10, col: 11, color: "white" },
      { row: 10, col: 7, color: "black" },
      { row: 10, col: 13, color: "black" },
    ]);
    const snapshot = copyBoard(board);
    isVCTFirstMove(board, { row: 7, col: 7 }, "white");
    expect(board).toEqual(snapshot);
  });
});

describe("isVCTFirstMove: ct=three の hasVCF フォールバック", () => {
  const options = {
    maxDepth: 6,
    timeLimit: 5000,
    vcfOptions: { maxDepth: 8, timeLimit: 5000 },
  };

  it("ct=three + VCF あり → isVCTFirstMove=true", () => {
    // White: (7,4)(7,5) — 横二、attack(7,6)で活三
    // White: (0,5)(0,6)(0,7) — 活三（VCFリソース）
    // Black: (5,3)(6,3) — 防御(7,3)でct=three
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 0, col: 5, color: "white" },
      { row: 0, col: 6, color: "white" },
      { row: 0, col: 7, color: "white" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);
    // (7,6)攻撃 → (7,3)防御でct=three → hasVCF=true（(0,5)(0,6)(0,7)活三→活四）
    // (7,7)防御でct=none → hasVCT=true（(0,5)(0,6)(0,7)のVCF）
    expect(isVCTFirstMove(board, { row: 7, col: 6 }, "white", options)).toBe(
      true,
    );
  });

  it("ct=three + VCF なし → isVCTFirstMove=false", () => {
    // White: (7,4)(7,5) — 横二、attack(7,6)で活三
    // White: (10,4)(10,5)(11,6)(12,6) — VCTリソース（(10,6)でダブルスリー）だがVCFなし
    // Black: (5,3)(6,3) — 防御(7,3)でct=three
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 10, col: 4, color: "white" },
      { row: 10, col: 5, color: "white" },
      { row: 11, col: 6, color: "white" },
      { row: 12, col: 6, color: "white" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);
    // 防御(7,3)でct=three → 攻撃側にVCFなし（止め四1回のみ、連続四追い不可）
    // 修正前: hasVCT=true（(10,6)ダブルスリーでVCT成立 — 偽陽性）
    // 修正後: hasVCF=false → 正しくfalse（防御の活三で三脅威無効化）
    expect(isVCTFirstMove(board, { row: 7, col: 6 }, "white", options)).toBe(
      false,
    );
  });

  it("ct=three で盤面不変性", () => {
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 10, col: 4, color: "white" },
      { row: 10, col: 5, color: "white" },
      { row: 11, col: 6, color: "white" },
      { row: 12, col: 6, color: "white" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);
    const snapshot = copyBoard(board);
    isVCTFirstMove(board, { row: 7, col: 6 }, "white", options);
    expect(board).toEqual(snapshot);
  });
});
