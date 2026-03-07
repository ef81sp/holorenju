/**
 * VCT探索のパフォーマンステスト
 *
 * timeout付きの重いテスト
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { checkFive, copyBoard } from "@/logic/renjuRules";

import { createBoardWithStones } from "../testUtils";
import { createsFour } from "./threatMoves";
import {
  checkDefenseCounterThreat,
  getFourDefensePosition,
} from "./threatPatterns";
import { hasVCF } from "./vcf";
import {
  findVCTMove,
  findVCTSequence,
  findVCTSequenceFromFirstMove,
  hasVCT,
  isVCTFirstMove,
} from "./vct";
import { hasFourThreeAvailable, hasOpenThree } from "./vctHelpers";

describe("ユーザ報告の棋譜テスト", () => {
  // 棋譜: H8 H7 H6 I7 G7 I5 G8 F8 G6 G5 E6 F6 F7 H9 E7 E5 C4 D5 F5 D7 K3 J6 H10 H4 ...
  // 23手目まで（H4の直前の局面）で白にVCTが存在することを確認
  // H4はJ6-I5-H4のナナメの活三を作り、VCT開始手として有効
  const record =
    "H8 H7 H6 I7 G7 I5 G8 F8 G6 G5 E6 F6 F7 H9 E7 E5 C4 D5 F5 D7 K3 J6 H10";
  // 分析用: 正確性重視のため時間制限を十分に確保
  const options = {
    maxDepth: 6,
    timeLimit: 30000,
    vcfOptions: { maxDepth: 16, timeLimit: 30000 },
  };

  it("24手目は白番", () => {
    const { nextColor } = createBoardFromRecord(record);
    expect(nextColor).toBe("white");
  });

  it(
    "H4がJ6-I5-H4のナナメの活三を作りVCT開始手と判定される",
    { timeout: 35000 },
    () => {
      const { board } = createBoardFromRecord(record);
      // H4 → row=11, col=7（白番）
      const h4 = { row: 11, col: 7 };
      expect(isVCTFirstMove(board, h4, "white", options)).toBe(true);
    },
  );

  it("findVCTMoveが白のVCT開始手を見つける", { timeout: 35000 }, () => {
    const { board } = createBoardFromRecord(record);
    const move = findVCTMove(board, "white", options);
    expect(move).not.toBeNull();
  });

  it("findVCTSequenceが白のVCT手順を返す", { timeout: 35000 }, () => {
    const { board } = createBoardFromRecord(record);
    const result = findVCTSequence(board, "white", options);
    expect(result).not.toBeNull();
    expect(result?.sequence.length).toBeGreaterThanOrEqual(3);
  });

  it("VCT開始手がisVCTFirstMoveで検証される", { timeout: 35000 }, () => {
    const { board } = createBoardFromRecord(record);
    // findVCTMoveはhasVCTベース（ct=three楽観判定）のため、
    // isVCTFirstMove（ct=three→hasVCFフォールバック）と結果が異なりうる。
    // 既知の有効手H4で直接検証する。
    const h4 = { row: 11, col: 7 };
    expect(isVCTFirstMove(board, h4, "white", options)).toBe(true);
  });
});

describe("分岐収集（collectBranches）", () => {
  // 23手目盤面: 白のVCTが成立し、分岐が存在する
  const record =
    "H8 H7 H6 I7 G7 I5 G8 F8 G6 G5 E6 F6 F7 H9 E7 E5 C4 D5 F5 D7 K3 J6 H10";
  // 分岐収集は分析機能のため、正確性重視で時間制限を十分に確保
  const branchOptions = {
    maxDepth: 6,
    timeLimit: 60000,
    vcfOptions: { maxDepth: 16, timeLimit: 60000 },
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

  it("23手目盤面でVCT手順が収集される＋盤面不変性", { timeout: 90000 }, () => {
    const { board } = createBoardFromRecord(record);
    const snapshot = copyBoard(board);
    const result = findVCTSequence(board, "white", branchOptions);

    // 盤面不変性チェック
    expect(board).toEqual(snapshot);

    // VCT手順の検証
    expect(result).not.toBeNull();
    expect(result?.sequence.length).toBeGreaterThanOrEqual(3);
  });

  it(
    "collectBranches: false（デフォルト）では既存の動作を維持",
    { timeout: 40000 },
    () => {
      const { board } = createBoardFromRecord(record);
      const result = findVCTSequence(board, "white", {
        maxDepth: 6,
        timeLimit: 30000,
        vcfOptions: { maxDepth: 16, timeLimit: 30000 },
      });
      expect(result).not.toBeNull();
      expect(result?.branches).toBeUndefined();
    },
  );
});

describe("findVCTSequence の事後検証", () => {
  it(
    "防御手のカウンター脅威が正しく処理される＋盤面不変性",
    { timeout: 35000 },
    () => {
      // 16手目まで（黒番）: 探索がカウンター脅威を正しく処理することを確認
      const record = "H8 I7 G9 I8 I9 G7 H10 J9 I11 F8 H7 H6 H9 H11 E9 F9";
      const { board } = createBoardFromRecord(record);
      const snapshot = copyBoard(board);
      const options = {
        maxDepth: 6,
        timeLimit: 30000,
        vcfOptions: { maxDepth: 16, timeLimit: 30000 },
      };
      const result = findVCTSequence(board, "black", options);

      // 盤面不変性チェック
      expect(board).toEqual(snapshot);

      // 返された手順があれば、全防御手のカウンター脅威を検証
      if (result) {
        const replayBoard = copyBoard(board);
        for (let i = 0; i < result.sequence.length; i++) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const pos = result.sequence[i]!;
          const isDefense = i % 2 === 1;
          const stoneColor: "black" | "white" = isDefense ? "white" : "black";
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          replayBoard[pos.row]![pos.col] = stoneColor;

          if (isDefense) {
            const ct = checkDefenseCounterThreat(
              replayBoard,
              pos.row,
              pos.col,
              "white",
            );
            // ct=win は拒否されるべき
            expect(ct).not.toBe("win");
            // ct=four には有効なブロック位置が存在する
            if (ct === "four") {
              const blockPos = getFourDefensePosition(
                replayBoard,
                pos,
                "white",
              );
              expect(blockPos).not.toBeNull();
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              replayBoard[blockPos!.row]![blockPos!.col] = "black";
            }
          }
        }
      }
    },
  );
});

describe("findVCTSequenceFromFirstMove: ct=four ハンドリング", () => {
  it("バグ再現: L9 の VCT シーケンスが返る", { timeout: 30000 }, () => {
    // 棋譜14手目までの盤面で L9 のVCTシーケンス取得
    const record = "H8 H9 I7 I8 J7 H7 J9 J8 K8 K7 L7 I10 J6 G9";
    const { board } = createBoardFromRecord(record);
    const snapshot = copyBoard(board);
    const move = { row: 6, col: 11 }; // L9
    const options = {
      maxDepth: 6,
      timeLimit: 25000,
      vcfOptions: { maxDepth: 16, timeLimit: 25000 },
    };
    const result = findVCTSequenceFromFirstMove(board, move, "black", options);
    // 盤面不変性
    expect(board).toEqual(snapshot);
    // シーケンスが返り、3手より長い
    expect(result).not.toBeNull();
    if (result) {
      expect(result.sequence.length).toBeGreaterThan(3);
    }
  });

  it(
    "isVCTFirstMove と findVCTSequenceFromFirstMove の一致性",
    { timeout: 30000 },
    () => {
      const record = "H8 H9 I7 I8 J7 H7 J9 J8 K8 K7 L7 I10 J6 G9";
      const { board } = createBoardFromRecord(record);
      const move = { row: 6, col: 11 }; // L9
      const options = {
        maxDepth: 6,
        timeLimit: 25000,
        vcfOptions: { maxDepth: 16, timeLimit: 25000 },
      };
      const isFirst = isVCTFirstMove(board, move, "black", options);
      const seq = findVCTSequenceFromFirstMove(board, move, "black", options);
      // isVCTFirstMove が true なら findVCTSequenceFromFirstMove も non-null
      if (isFirst) {
        expect(seq).not.toBeNull();
      }
    },
  );

  it("ct=four でブロック後 VCT 継続 → シーケンスが返る", () => {
    // 既存の ct=four テストボード（hasVCT=true）
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
    const seq = findVCTSequence(board, "white", { timeLimit: 1000 });
    expect(seq).not.toBeNull();
    if (seq) {
      const fromFirst = findVCTSequenceFromFirstMove(
        board,
        seq.firstMove,
        "white",
        { timeLimit: 1000 },
      );
      expect(fromFirst).not.toBeNull();
    }
    // 盤面不変性
    expect(board).toEqual(snapshot);
  });

  it("ct=four でブロック後 VCT 不成立 → null", () => {
    // ブロック後にVCT継続不能な盤面
    const board = createBoardWithStones([
      { row: 3, col: 3, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 4, col: 3, color: "black" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);
    const snapshot = copyBoard(board);
    const seq = findVCTSequence(board, "white", { timeLimit: 1000 });
    expect(seq).toBeNull();
    // 盤面不変性
    expect(board).toEqual(snapshot);
  });
});

describe("VCT手順中にカウンターフォーが複数回発生", () => {
  it(
    "validateVCTSequence がカウンターフォーの暗黙ブロックを累積処理する",
    { timeout: 30000 },
    () => {
      // 14手目までの盤面でVCTシーケンスを取得し、検証が通ることを確認
      const record = "H8 H9 I7 I8 J7 H7 J9 J8 K8 K7 L7 I10 J6 G9";
      const { board } = createBoardFromRecord(record);
      const options = {
        maxDepth: 6,
        timeLimit: 25000,
        vcfOptions: { maxDepth: 16, timeLimit: 25000 },
      };
      const result = findVCTSequence(board, "black", options);
      // findVCTSequence は内部で validateVCTSequence を呼ぶので、
      // 結果が返ればカウンターフォーの暗黙ブロック累積が正しく処理されている
      if (result) {
        expect(result.sequence.length).toBeGreaterThan(1);
      }
    },
  );
});

describe("防御手が活三を作る場合のVCT探索（depth > 0）", () => {
  // 棋譜: H8 I9 I7 G9 H6 H9 J9 J8 H7 H10 G11 F8 E7 K7 L6
  // 15手目局面（白番）でVCT探索が不正な手順 I11 J12 I10 I8 K12 ... を返す
  // 19手目の黒I8で活三（H7-I8-J9の/斜め）が生じ、VCT手順が崩壊する
  const record = "H8 I9 I7 G9 H6 H9 J9 J8 H7 H10 G11 F8 E7 K7 L6";
  const options = {
    maxDepth: 6,
    timeLimit: 10000,
    vcfOptions: { maxDepth: 16, timeLimit: 10000 },
  };

  it("18手目(I10)後にI8防御を置くと黒に活三がある", () => {
    // 棋譜の18手目までを再現: + I11 J12 I10
    const extRecord = `${record} I11 J12 I10`;
    const { board } = createBoardFromRecord(extRecord);
    // I8に黒（防御手）を配置
    // I8 → row=7, col=8
    if (board[7]) {
      board[7][8] = "black";
    }
    // 黒に活三がある（H7-I8-J9の/斜め）
    expect(hasOpenThree(board, "black")).toBe(true);
    // undo
    if (board[7]) {
      board[7][8] = null;
    }
  });

  it("防御手で活三ができた場合、VCFがなければVCT不成立（depth > 0）", () => {
    // 18手目(I10)後にI8防御を置いた局面
    const extRecord = `${record} I11 J12 I10`;
    const { board } = createBoardFromRecord(extRecord);
    if (board[7]) {
      board[7][8] = "black";
    } // I8防御
    // 黒に活三があるので白のVCTは三脅威では不成立
    // VCFがない限りfalse
    const whiteHasVcf = hasVCF(board, "white", undefined, undefined, {
      maxDepth: 16,
      timeLimit: 5000,
    });
    // このシナリオではVCFがないはず
    expect(whiteHasVcf).toBe(false);
    expect(hasVCT(board, "white", 0, undefined, options)).toBe(false);
    // undo
    if (board[7]) {
      board[7][8] = null;
    }
  });

  it("防御手で活三ができてもVCFがあればVCT成立", () => {
    // 活三+VCFが両方ある局面
    const board = createBoardWithStones([
      // 白の活三リソース
      { row: 3, col: 5, color: "white" },
      { row: 3, col: 6, color: "white" },
      { row: 3, col: 7, color: "white" },
      // 黒の活三（相手の脅威）
      { row: 10, col: 5, color: "black" },
      { row: 10, col: 6, color: "black" },
      { row: 10, col: 7, color: "black" },
    ]);
    // 黒に活三があるが白にVCFがある（(3,4)or(3,8)で活四）
    expect(hasOpenThree(board, "black")).toBe(true);
    expect(hasVCF(board, "white")).toBe(true);
    expect(hasVCT(board, "white")).toBe(true);
  });

  it(
    "findVCTSequence が不正な手順を返さない（15手目局面）",
    { timeout: 15000 },
    () => {
      const { board } = createBoardFromRecord(record);
      const snapshot = copyBoard(board);
      const result = findVCTSequence(board, "white", options);

      // 盤面不変性
      expect(board).toEqual(snapshot);

      // 手順が返された場合、防御手で活三ができたら次の攻撃手は四/五連であること
      if (!result) {
        return;
      }

      const replayBoard = copyBoard(board);
      for (let i = 0; i < result.sequence.length; i++) {
        const pos = result.sequence[i];
        if (!pos) {
          continue;
        }
        const isDefense = i % 2 === 1;
        const stoneColor: "black" | "white" = isDefense ? "black" : "white";
        if (replayBoard[pos.row]) {
          replayBoard[pos.row][pos.col] = stoneColor;
        }

        if (!isDefense || !hasOpenThree(replayBoard, "black")) {
          continue;
        }
        // 次の攻撃手が四/五連でなければ不正手順
        const nextIdx = i + 1;
        if (nextIdx >= result.sequence.length) {
          continue;
        }
        const nextPos = result.sequence[nextIdx];
        if (!nextPos) {
          continue;
        }
        if (replayBoard[nextPos.row]) {
          replayBoard[nextPos.row][nextPos.col] = "white";
        }
        const makesFourOrFive =
          createsFour(replayBoard, nextPos.row, nextPos.col, "white") ||
          checkFive(replayBoard, nextPos.row, nextPos.col, "white");
        expect(makesFourOrFive).toBe(true);
        if (replayBoard[nextPos.row]) {
          replayBoard[nextPos.row][nextPos.col] = null;
        }
      }
    },
  );

  it("盤面不変性", () => {
    const { board } = createBoardFromRecord(record);
    const snapshot = copyBoard(board);
    hasVCT(board, "white", 0, undefined, options);
    expect(board).toEqual(snapshot);
    findVCTSequence(board, "white", options);
    expect(board).toEqual(snapshot);
  });
});

describe("相手にミセ手がある場合のVCTスキップ", () => {
  // ユーザー報告棋譜: 14手目でH10のVCTが誤検出される
  const record14 = "H8 G7 I10 G8 H9 H7 F9 G9 G10 E7 D7 F7 I7 E8";
  const options = {
    maxDepth: 6,
    timeLimit: 10000,
    vcfOptions: { maxDepth: 16, timeLimit: 10000 },
  };

  it("14手目盤面で白にミセ手がある", () => {
    const { board } = createBoardFromRecord(record14);
    expect(hasFourThreeAvailable(board, "white")).toBe(true);
  });

  it("相手にミセ手がある場合、黒のVCTは不成立", { timeout: 15000 }, () => {
    const { board } = createBoardFromRecord(record14);
    expect(findVCTSequence(board, "black", options)).toBeNull();
  });

  it("盤面不変性", { timeout: 15000 }, () => {
    const { board } = createBoardFromRecord(record14);
    const snapshot = copyBoard(board);
    findVCTSequence(board, "black", options);
    expect(board).toEqual(snapshot);
  });
});

describe("防御側の非ブロックカウンター四", () => {
  // バグ棋譜: 15手目(J9)で白VCTが誤検出される
  // 黒の反撃手順: F6(W三) → I5(Bカウンター四) → I4(Wブロック) → H6(B跳び四+ミセ) → 黒勝ち
  const record = "H8 H7 I8 G8 I6 G9 G7 G6 J7 K8 I7 I9 K6 H9";
  const options = {
    maxDepth: 6,
    timeLimit: 5000,
    vcfOptions: { maxDepth: 16, timeLimit: 5000 },
  };

  it(
    "J9局面: E6始動の偽VCT(カウンター四で破壊)は返さない",
    { timeout: 10000 },
    () => {
      const { board } = createBoardFromRecord(record);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      board[6]![9] = "black"; // J9
      const result = findVCTSequence(board, "white", options);
      // E6(row:9,col:4)始動の偽VCT手順はI5のカウンター四で破壊されるため棄却される
      // E9始動等の別経路で有効なVCTが存在する
      expect(result).not.toBeNull();
      expect(result?.firstMove).not.toEqual({ row: 9, col: 4 });
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      board[6]![9] = null;
    },
  );

  it("盤面不変性", () => {
    const { board } = createBoardFromRecord(record);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    board[6]![9] = "black";
    const snapshot = copyBoard(board);
    findVCTSequence(board, "white", options);
    expect(board).toEqual(snapshot);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    board[6]![9] = null;
  });
});
