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

  it("14手目盤面で分岐が収集される", { timeout: 15000 }, () => {
    const record = "H8 I7 G7 I9 H6 J8 H10 H9 G9 J7 H7 G8 I8 J9";
    const { board } = createBoardFromRecord(record);
    const options = {
      maxDepth: 6,
      timeLimit: 5000,
      vcfOptions: { maxDepth: 16, timeLimit: 5000 },
      collectBranches: true,
    };
    const result = findVCTSequence(board, "black", options);
    expect(result).not.toBeNull();
    expect(result?.branches).toBeDefined();
    expect(result!.branches!.length).toBeGreaterThan(0);

    // 各分岐にcontinuationがある
    for (const branch of result!.branches!) {
      expect(branch.defenseMove).toBeDefined();
      expect(branch.continuation.length).toBeGreaterThan(0);
    }
  });

  it("メインPVは最長の防御継続を選択", { timeout: 15000 }, () => {
    const record = "H8 I7 G7 I9 H6 J8 H10 H9 G9 J7 H7 G8 I8 J9";
    const { board } = createBoardFromRecord(record);
    const options = {
      maxDepth: 6,
      timeLimit: 5000,
      vcfOptions: { maxDepth: 16, timeLimit: 5000 },
      collectBranches: true,
    };
    const result = findVCTSequence(board, "black", options);
    expect(result).not.toBeNull();

    // E7の跳び三の後、F8（中止め）が最強防御 → PVに含まれる
    const e7Idx = result!.sequence.findIndex((p) => p.row === 8 && p.col === 4);
    expect(e7Idx).toBeGreaterThan(0);
    const defenseAfterE7 = result!.sequence[e7Idx + 1];
    expect(defenseAfterE7).toEqual({ row: 7, col: 5 }); // F8

    // 分岐にはI11やD6が含まれる
    if (result!.branches && result!.branches.length > 0) {
      const branchDefenses = result!.branches.map(
        (b) => `${b.defenseMove.row},${b.defenseMove.col}`,
      );
      // I11(4,8) or D6(9,3) が分岐に含まれる
      const hasAlternative =
        branchDefenses.includes("4,8") || branchDefenses.includes("9,3");
      expect(hasAlternative).toBe(true);
    }
  });

  it(
    "defenseIndexがsequence内の防御手位置を正しく指す",
    { timeout: 15000 },
    () => {
      const record = "H8 I7 G7 I9 H6 J8 H10 H9 G9 J7 H7 G8 I8 J9";
      const { board } = createBoardFromRecord(record);
      const options = {
        maxDepth: 6,
        timeLimit: 5000,
        vcfOptions: { maxDepth: 16, timeLimit: 5000 },
        collectBranches: true,
      };
      const result = findVCTSequence(board, "black", options);
      expect(result).not.toBeNull();
      expect(result!.branches).toBeDefined();

      for (const branch of result!.branches!) {
        // defenseIndexの位置にあるメインPVの手は防御手（偶数インデックス=攻撃、奇数=防御）
        // sequenceは [攻撃, 防御, 攻撃, 防御, ...] なので奇数インデックスが防御
        expect(branch.defenseIndex % 2).toBe(1);

        // defenseIndexの位置にある手は分岐先の防御手と同じ「役割」（同じ攻撃手への防御）
        // メインPVのdefenseIndex位置の手が存在する
        const mainDefense = result!.sequence[branch.defenseIndex];
        expect(mainDefense).toBeDefined();

        // 分岐の防御手はメインPVの防御手と異なる
        expect(branch.defenseMove).not.toEqual(mainDefense);
      }
    },
  );

  it(
    "collectBranches: false（デフォルト）では既存の動作を維持",
    { timeout: 15000 },
    () => {
      const record = "H8 I7 G7 I9 H6 J8 H10 H9 G9 J7 H7 G8 I8 J9";
      const { board } = createBoardFromRecord(record);
      const options = {
        maxDepth: 6,
        timeLimit: 5000,
        vcfOptions: { maxDepth: 16, timeLimit: 5000 },
      };
      const result = findVCTSequence(board, "black", options);
      expect(result).not.toBeNull();
      expect(result?.branches).toBeUndefined();
    },
  );

  it("盤面不変性（collectBranches: true）", { timeout: 15000 }, () => {
    const record = "H8 I7 G7 I9 H6 J8 H10 H9 G9 J7 H7 G8 I8 J9";
    const { board } = createBoardFromRecord(record);
    const snapshot = copyBoard(board);
    findVCTSequence(board, "black", {
      maxDepth: 6,
      timeLimit: 5000,
      vcfOptions: { maxDepth: 16, timeLimit: 5000 },
      collectBranches: true,
    });
    expect(board).toEqual(snapshot);
  });
});

describe("跳び三防御の検証", () => {
  // 14手目までの盤面
  // H8 I7 G7 I9 H6 J8 H10 H9 G9 J7 H7 G8 I8 J9
  // VCT: H5(四)→H4(防御)→E7(跳び三)→... 全防御でVCT継続
  const record = "H8 I7 G7 I9 H6 J8 H10 H9 G9 J7 H7 G8 I8 J9";
  const options = {
    maxDepth: 6,
    timeLimit: 5000,
    vcfOptions: { maxDepth: 16, timeLimit: 5000 },
  };

  it("E7の跳び三の防御位置にF8(中止め)が含まれる", () => {
    const { board } = createBoardFromRecord(record);
    // H5(四) → H4(防御) → E7(跳び三) の局面を構築
    board[10]![7] = "black"; // H5
    board[11]![7] = "white"; // H4
    board[8]![4] = "black"; // E7

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
    board[10]![7] = null;
    board[11]![7] = null;
    board[8]![4] = null;
  });

  it("14手目盤面のVCTは全防御を検証済み", { timeout: 15000 }, () => {
    const { board } = createBoardFromRecord(record);
    const result = findVCTSequence(board, "black", options);
    expect(result).not.toBeNull();

    // H5が最初の手
    expect(result!.firstMove).toEqual({ row: 10, col: 7 });

    // PVにE7が含まれることを確認
    const e7Idx = result!.sequence.findIndex((p) => p.row === 8 && p.col === 4);
    expect(e7Idx).toBeGreaterThan(0);
    // collectBranchesなしの場合は最初の防御がPVに入る
    const defenseAfterE7 = result!.sequence[e7Idx + 1];
    expect(defenseAfterE7).toBeDefined();
  });

  it("E7跳び三の全防御後にVCT継続", { timeout: 15000 }, () => {
    const { board } = createBoardFromRecord(record);
    board[10]![7] = "black"; // H5
    board[11]![7] = "white"; // H4
    board[8]![4] = "black"; // E7

    // 各防御後にVCTが継続することを確認（全防御で勝ち = 正当なVCT）
    board[7]![5] = "white"; // F8(中止め)
    expect(hasVCT(board, "black", 0, undefined, options)).toBe(true);
    board[7]![5] = null;

    board[9]![3] = "white"; // D6(外止め)
    expect(hasVCT(board, "black", 0, undefined, options)).toBe(true);
    board[9]![3] = null;

    board[4]![8] = "white"; // I11(外止め)
    expect(hasVCT(board, "black", 0, undefined, options)).toBe(true);
    board[4]![8] = null;

    // undo
    board[10]![7] = null;
    board[11]![7] = null;
    board[8]![4] = null;
  });

  it("盤面不変性", () => {
    const { board } = createBoardFromRecord(record);
    const snapshot = copyBoard(board);
    findVCTSequence(board, "black", options);
    expect(board).toEqual(snapshot);
  });
});
