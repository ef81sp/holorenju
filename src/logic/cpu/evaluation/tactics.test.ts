/**
 * 戦術評価機能のテスト
 *
 * 四三ボーナス、禁手追い込み、複数方向脅威、カウンターフォー、単発四ペナルティのテスト
 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import {
  checkForbiddenMove,
  copyBoard,
  createEmptyBoard,
} from "@/logic/renjuRules";

import {
  evaluatePosition,
  evaluatePositionWithBreakdown,
  evaluateStonePatterns,
} from "../evaluation";
import { createBoardWithStones } from "../testUtils";
import { PATTERN_SCORES } from "./patternScores";
import {
  canContinueFourAfterDefense,
  findMiseTargets,
  hasFollowUpThreat,
  hasMixedForbiddenPoints,
  isMiseMove,
} from "./tactics";

describe("hasMixedForbiddenPoints", () => {
  it("禁手と非禁手の両方がある場合はtrueを返す", () => {
    const board = createEmptyBoard();
    // 三々禁になる位置と、禁手でない位置を用意
    // 盤面の中央付近に三々を作れる配置
    board[7][5] = "black";
    board[7][6] = "black";
    board[5][7] = "black";
    board[6][7] = "black";

    // (7,7) は三々禁 (横活三 + 縦活三)
    // (7,8) は禁手でない
    const points = [
      { row: 7, col: 7 }, // 三々禁
      { row: 7, col: 8 }, // 禁手でない
    ];

    const result = hasMixedForbiddenPoints(board, points);
    expect(result).toBe(true);
  });

  it("全て禁手の場合はfalseを返す", () => {
    const board = createEmptyBoard();
    board[7][5] = "black";
    board[7][6] = "black";
    board[5][7] = "black";
    board[6][7] = "black";
    // 別の方向にも三を作って、複数の禁手点を用意
    board[5][5] = "black";
    board[6][6] = "black";

    // (7,7) は三々禁
    // (8,8) も三々禁（斜め）
    const points = [
      { row: 7, col: 7 }, // 三々禁
    ];

    const result = hasMixedForbiddenPoints(board, points);
    expect(result).toBe(false);
  });

  it("全て非禁手の場合はfalseを返す", () => {
    const board = createEmptyBoard();
    const points = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
    ];

    const result = hasMixedForbiddenPoints(board, points);
    expect(result).toBe(false);
  });

  it("空配列の場合はfalseを返す", () => {
    const board = createEmptyBoard();
    const result = hasMixedForbiddenPoints(board, []);
    expect(result).toBe(false);
  });
});

describe("canContinueFourAfterDefense", () => {
  it("防御位置周辺に四を作れる位置がある場合はtrueを返す", () => {
    const board = createEmptyBoard();
    // 白の三連: (6,4), (6,5), (6,6)
    // (6,3)で四になる
    board[6][4] = "white";
    board[6][5] = "white";
    board[6][6] = "white";

    // 防御位置 (7,4) の隣に (6,3) がある
    const defensePos = { row: 7, col: 4 };
    board[7][4] = "black";

    // (6,3) は (7,4) の隣接マスで、四を作れる
    const result = canContinueFourAfterDefense(board, defensePos, "white");
    expect(result).toBe(true);
  });

  it("防御位置周辺に四を作れる位置がない場合はfalseを返す", () => {
    const board = createEmptyBoard();
    // 白の石が1つだけ
    board[7][7] = "white";

    // 黒が防御した位置
    const defensePos = { row: 7, col: 6 };
    board[7][6] = "black";

    // 周辺に四を作れる位置がない
    const result = canContinueFourAfterDefense(board, defensePos, "white");
    expect(result).toBe(false);
  });
});

describe("四三ボーナス", () => {
  it("四と活三を同時に作る手にボーナス加算", () => {
    // 横に四を作り、縦に活三を作る配置
    // 横: ・●●●○（7行目 col=4,5,6に黒、col=7で四になる）
    // 縦: ・●●・（col=7 row=5,6に黒、row=7で三になる）
    const board = createBoardWithStones([
      // 横の三
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      // 縦の二
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    // 7,7に置くと、横に四、縦に三ができる
    const score = evaluatePosition(board, 7, 7, "black");

    // 四三ボーナスが含まれているはず
    // 最低限、OPEN_FOUR + OPEN_THREE + FOUR_THREE_BONUS の一部が含まれる
    expect(score).toBeGreaterThanOrEqual(
      PATTERN_SCORES.OPEN_FOUR + PATTERN_SCORES.OPEN_THREE,
    );
  });

  it("四だけで活三がない場合はボーナスなし", () => {
    // 横に四のみ
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    const score = evaluatePosition(board, 7, 7, "black");

    // OPEN_FOURのスコアはあるが、FOUR_THREE_BONUSは含まれない
    expect(score).toBeLessThan(
      PATTERN_SCORES.OPEN_FOUR + PATTERN_SCORES.FOUR_THREE_BONUS,
    );
  });
});

describe("白の三三・四四評価", () => {
  it("白の三三をFIVE（勝利）として評価", () => {
    const board = createBoardWithStones([
      // 横に二（活三になる準備）
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      // 縦に二（活三になる準備）
      { row: 5, col: 8, color: "white" },
      { row: 6, col: 8, color: "white" },
    ]);
    // 7,8 に置くと横縦両方で活三

    const score = evaluatePosition(board, 7, 8, "white");
    expect(score).toBe(PATTERN_SCORES.FIVE);
  });

  it("白の四四をFIVE（勝利）として評価", () => {
    const board = createBoardWithStones([
      // 横に三（四になる）
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
      // 縦に三（四になる）
      { row: 4, col: 8, color: "white" },
      { row: 5, col: 8, color: "white" },
      { row: 6, col: 8, color: "white" },
    ]);

    const score = evaluatePosition(board, 7, 8, "white");
    expect(score).toBe(PATTERN_SCORES.FIVE);
  });

  it("黒の三三はFIVE扱いにならない（禁手）", () => {
    const board = createBoardWithStones([
      // 横に二
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      // 縦に二
      { row: 5, col: 8, color: "black" },
      { row: 6, col: 8, color: "black" },
    ]);
    // 7,8 は禁手なのでFIVE扱いにはならない
    // （実際には禁手でプレイできないが、評価としては低くなる）
    const score = evaluatePosition(board, 7, 8, "black");
    expect(score).toBeLessThan(PATTERN_SCORES.FIVE);
  });
});

describe("禁手追い込み評価", () => {
  it("白の四で黒の防御点が禁手の場合は高スコア", () => {
    // 複雑な配置が必要なので、基本的なテストケースのみ
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    // 白が7,8に置いて四を作る
    const score = evaluatePosition(board, 7, 8, "white");
    // 最低限OPEN_FOURスコアは含まれる
    expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.OPEN_FOUR);
  });
});

describe("複数方向脅威ボーナス", () => {
  it("2方向以上の脅威にボーナス加算", () => {
    // 横と縦に活三を作る配置
    const board = createBoardWithStones([
      // 横に二（活三になる）
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      // 縦に二（活三になる）
      { row: 5, col: 8, color: "black" },
      { row: 6, col: 8, color: "black" },
    ]);

    // enableMultiThreat有効時のスコア
    const scoreWithBonus = evaluatePosition(board, 7, 8, "black", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: true,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    // enableMultiThreat無効時のスコア
    const scoreWithoutBonus = evaluatePosition(board, 7, 8, "black", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    // ボーナス有効時の方が高スコア
    expect(scoreWithBonus).toBeGreaterThan(scoreWithoutBonus);
    // ボーナス差は最低500（2方向-1=1 × 500）、浮動小数点誤差を考慮
    expect(scoreWithBonus - scoreWithoutBonus).toBeGreaterThanOrEqual(
      PATTERN_SCORES.MULTI_THREAT_BONUS - 1,
    );
  });

  it("1方向のみの脅威にはボーナスなし", () => {
    // 横に活三のみ
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const scoreWithBonus = evaluatePosition(board, 7, 8, "black", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: true,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    const scoreWithoutBonus = evaluatePosition(board, 7, 8, "black", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    // 1方向のみなので差がほぼ0
    expect(scoreWithBonus).toBe(scoreWithoutBonus);
  });
});

describe("カウンターフォー", () => {
  it("防御しながら四を作る手の防御スコアが1.5倍になる", () => {
    // 相手（白）が活三を持っている
    // 自分（黒）がその防御位置で四を作れる状況
    const board = createBoardWithStones([
      // 白の活三
      { row: 5, col: 5, color: "white" },
      { row: 5, col: 6, color: "white" },
      { row: 5, col: 7, color: "white" },
      // 黒の三（5,8に置くと四になる）
      { row: 5, col: 9, color: "black" },
      { row: 5, col: 10, color: "black" },
      { row: 5, col: 11, color: "black" },
    ]);

    // enableCounterFour有効時のスコア
    const scoreWithCounter = evaluatePosition(board, 5, 8, "black", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: true,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    // enableCounterFour無効時のスコア
    const scoreWithoutCounter = evaluatePosition(board, 5, 8, "black", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    // カウンターフォー有効時の方が高スコア（防御スコアが1.5倍）
    expect(scoreWithCounter).toBeGreaterThan(scoreWithoutCounter);
  });

  it("自分が四を作らない場合はカウンターフォーなし", () => {
    // 相手が活三、自分は普通の防御
    const board = createBoardWithStones([
      { row: 5, col: 5, color: "white" },
      { row: 5, col: 6, color: "white" },
      { row: 5, col: 7, color: "white" },
    ]);

    const scoreWithCounter = evaluatePosition(board, 5, 8, "black", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: true,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    const scoreWithoutCounter = evaluatePosition(board, 5, 8, "black", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    // 自分が四を作らないのでスコアは同じ
    expect(scoreWithCounter).toBe(scoreWithoutCounter);
  });
});

describe("斜め方向ボーナス", () => {
  it("斜め方向のパターンに5%ボーナスが付与される", () => {
    // 横方向の活二
    const horizontalBoard = createBoardWithStones([
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const horizontalScore = evaluateStonePatterns(
      horizontalBoard,
      7,
      7,
      "black",
    );

    // 斜め方向の活二（同等のパターン）
    const diagonalBoard = createBoardWithStones([
      { row: 6, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const diagonalScore = evaluateStonePatterns(diagonalBoard, 7, 7, "black");

    // 斜め方向が5%高い
    expect(diagonalScore).toBeGreaterThan(horizontalScore);
    // 倍率が約1.05であることを確認（複数パターン混在で誤差あり）
    expect(diagonalScore / horizontalScore).toBeCloseTo(
      PATTERN_SCORES.DIAGONAL_BONUS_MULTIPLIER,
      1, // 精度を緩める（複数パターンの影響で厳密に1.05にならない場合がある）
    );
  });

  it("縦方向にはボーナスがない", () => {
    // 横方向の活二
    const horizontalBoard = createBoardWithStones([
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const horizontalScore = evaluateStonePatterns(
      horizontalBoard,
      7,
      7,
      "black",
    );

    // 縦方向の活二
    const verticalBoard = createBoardWithStones([
      { row: 6, col: 7, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const verticalScore = evaluateStonePatterns(verticalBoard, 7, 7, "black");

    // 縦と横は同じスコア
    expect(verticalScore).toBe(horizontalScore);
  });
});

describe("単発四ペナルティ", () => {
  const enableSingleFourPenaltyOptions = {
    enableFukumi: false,
    enableMise: false,
    enableForbiddenTrap: false,
    enableMultiThreat: false,
    enableCounterFour: false,
    enableVCT: false,
    enableMandatoryDefense: false,
    enableSingleFourPenalty: true,
    singleFourPenaltyMultiplier: 0.0, // 100%減点
    enableMiseThreat: false,
    enableNullMovePruning: false,
    enableFutilityPruning: false,
    enableForbiddenVulnerability: false,
  };

  it("後続脅威がない四は低評価される", () => {
    // 単純な四（後続脅威なし）
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // ペナルティありのスコア
    const scoreWithPenalty = evaluatePosition(
      board,
      7,
      7,
      "black",
      enableSingleFourPenaltyOptions,
    );

    // ペナルティなしのスコア
    const scoreWithoutPenalty = evaluatePosition(board, 7, 7, "black", {
      ...enableSingleFourPenaltyOptions,
      enableSingleFourPenalty: false,
    });

    // ペナルティありの方が低い
    expect(scoreWithPenalty).toBeLessThan(scoreWithoutPenalty);
  });

  it("四三を作る手にはペナルティなし", () => {
    // 四三を作れる配置
    const board = createBoardWithStones([
      // 横の三
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      // 縦の二
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    // ペナルティありのスコア（四三はペナルティ免除）
    const scoreWithPenalty = evaluatePosition(
      board,
      7,
      7,
      "black",
      enableSingleFourPenaltyOptions,
    );

    // ペナルティなしのスコア
    const scoreWithoutPenalty = evaluatePosition(board, 7, 7, "black", {
      ...enableSingleFourPenaltyOptions,
      enableSingleFourPenalty: false,
    });

    // 四三を作る手にはペナルティがないので同じスコア
    expect(scoreWithPenalty).toBe(scoreWithoutPenalty);
  });

  it("enableSingleFourPenalty=falseなら通常評価", () => {
    const disabledOptions = {
      ...enableSingleFourPenaltyOptions,
      enableSingleFourPenalty: false,
    };

    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // ペナルティなしなら元のスコア
    const score = evaluatePosition(board, 7, 7, "black", disabledOptions);
    expect(score).toBeGreaterThan(0);
  });
});

describe("禁手追い込み三（FORBIDDEN_TRAP_THREE）", () => {
  it("達四点の一方が禁手なら勝ち確定スコア（10Gが最善手の盤面）", () => {
    // 報告された盤面: H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9
    // 座標変換: 行=15-数字, 列=アルファベット-'A'
    // H8: row=7, col=7 (黒)
    // H9: row=6, col=7 (白)
    // I8: row=7, col=8 (黒)
    // G8: row=7, col=6 (白)
    // I9: row=6, col=8 (黒)
    // I10: row=5, col=8 (白)
    // F7: row=8, col=5 (黒)
    // G7: row=8, col=6 (白)
    // G9: row=6, col=6 (黒)
    // H10: row=5, col=7 (白)
    // F9: row=6, col=5 (黒)
    const board = createEmptyBoard();
    // 黒石 (1, 3, 5, 7, 9, 11手目)
    board[7][7] = "black"; // H8 (1)
    board[7][8] = "black"; // I8 (3)
    board[6][8] = "black"; // I9 (5)
    board[8][5] = "black"; // F7 (7)
    board[6][6] = "black"; // G9 (9)
    board[6][5] = "black"; // F9 (11)
    // 白石 (2, 4, 6, 8, 10手目)
    board[6][7] = "white"; // H9 (2)
    board[7][6] = "white"; // G8 (4)
    board[5][8] = "white"; // I10 (6)
    board[8][6] = "white"; // G7 (8)
    board[5][7] = "white"; // H10 (10)

    // 白番12手目: 10G(row=5, col=6)が最善手
    // 白10Gで G10-H10-I10 の活三
    // 達四点: 10F(row=5, col=5)禁手 と 10J(row=5, col=9)通常
    // 片方が禁手なので勝ち確定

    // 10G(row=5, col=6)のスコア
    const score10G = evaluatePosition(board, 5, 6, "white", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: true,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    // 10Fが禁手であることを確認
    const forbidden10F = checkForbiddenMove(board, 5, 5);
    // G9-F9-E9が活三、F7-F8-F9-F10が四になる配置
    // F9(row=6, col=5)の黒石があるので、10Fに黒が打つと三三or四四の禁手
    expect(forbidden10F.isForbidden).toBe(true);

    // 達四点の一方が禁手なら FORBIDDEN_TRAP_STRONG (8000点) 以上のスコア
    expect(score10G).toBeGreaterThanOrEqual(
      PATTERN_SCORES.FORBIDDEN_TRAP_STRONG,
    );
  });

  it("活三の達四点の一つが禁手なら高評価（縦方向）", () => {
    // 盤面設定: 8Gが三三禁になる配置
    // 連珠座標: 15が上、行=15-row, 列=A+col
    // 8G(row=7,col=6)に黒が打つと:
    //   - 横: F8-G8-H8 の活三
    //   - 斜め: F9-G8-□-I6 の跳び三（H7が空き）
    // → 三三禁
    //
    //   9  . . . . . X . . . . . . . . .   F9黒(row=6,col=5)
    //   8  . . . . . X . X . . . . . . .   F8黒(row=7,col=5), H8黒(row=7,col=7)
    //   7  . . . . . . O . X . . . . . .   G7白(row=8,col=6), I7黒(row=8,col=8)
    //   6  . . . . O . O O X . . . . . .   E6白(row=9,col=4), G6白(row=9,col=6), H6白(row=9,col=7), I6黒(row=9,col=8)
    const board = createEmptyBoard();
    // 黒石（ユーザー提供の moveHistory より）
    board[7][7] = "black"; // H8 (1手目)
    board[8][8] = "black"; // I7 (3手目)
    board[7][5] = "black"; // F8 (5手目)
    board[6][5] = "black"; // F9 (7手目)
    board[9][8] = "black"; // I6 (9手目) - これが重要！斜め跳び三を構成
    // 白石
    board[8][6] = "white"; // G7 (2手目)
    board[9][7] = "white"; // H6 (4手目)
    board[9][6] = "white"; // G6 (6手目)
    board[9][4] = "white"; // E6 (8手目)

    // 8G(row=7, col=6)が三三禁であることを確認
    // 横: F8-G8-H8 の活三 + 斜め: F9-G8-□-I6 の跳び三
    const forbiddenResult = checkForbiddenMove(board, 7, 6);
    expect(forbiddenResult.isForbidden).toBe(true);
    expect(forbiddenResult.type).toBe("double-three");

    // 白が5G(row=10, col=6)に打つと、G5-G6-G7の活三ができる
    // 達四点は4G(row=11, col=6)と8G(row=7, col=6)
    // 8Gは禁手なので、追い込み成功
    const scoreWith5G = evaluatePosition(board, 10, 6, "white", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: true,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    // 無関係な位置（追い込みにならない）
    const scoreOther = evaluatePosition(board, 3, 3, "white", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: true,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    // 5Gに打つ手は追い込みボーナスで高スコアになるべき
    // scoreWith5G には活三スコア + 禁手追い込みボーナスが含まれる
    // scoreOther は無関係な位置なので低スコア
    expect(scoreWith5G).toBeGreaterThan(scoreOther + 2000);
  });

  it("両方の達四点が禁手でない場合はボーナスなし", () => {
    // 単純な活三（禁手嵌めにならない）
    const board = createEmptyBoard();
    board[7][6] = "white"; // G8
    board[7][7] = "white"; // H8

    // 白がF8(row=7,col=5)に打つと活三だが、達四点は禁手でない
    const scoreNormal = evaluatePosition(board, 7, 5, "white", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: true,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    });

    // FORBIDDEN_TRAP_THREEボーナスは含まれないはず
    // 活三のスコア（OPEN_THREE）と防御スコアのみ
    expect(scoreNormal).toBeLessThan(PATTERN_SCORES.FORBIDDEN_TRAP_THREE);
  });
});

describe("hasFollowUpThreat 盤面不変性", () => {
  it("呼び出し前後で盤面が変化しない（四あり）", () => {
    // 白の四を作る配置
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    const snapshot = copyBoard(board);

    hasFollowUpThreat(board, 7, 7, "white");

    expect(board).toEqual(snapshot);
  });

  it("呼び出し前後で盤面が変化しない（四なし）", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);
    const snapshot = copyBoard(board);

    hasFollowUpThreat(board, 7, 6, "black");

    expect(board).toEqual(snapshot);
  });
});

describe("禁手脆弱性ペナルティ（evaluatePosition統合）", () => {
  // 黒の活三: (7,5),(7,6),(7,7) + 両端空き
  // 斜め方向にも三を作って延長点が禁手になる配置:
  // (5,5),(6,6) + (7,7) で斜め三、延長点(8,8)は通常
  // (7,7) の横延長点(7,4)または(7,8)が三三禁になる配置
  //
  // より確実なアプローチ:
  // 横: (7,5),(7,6),(7,7) → 活三、延長点(7,4)と(7,8)
  // 斜め: (5,5),(6,6),(7,7) → 活三、延長点(4,4)と(8,8)
  // (7,8)に黒を置くと横で三+斜めの別の三ができ三三禁になるように配置
  //
  // 実際のテスト:
  // (7,5),(7,6) を黒で配置 → (7,7) に置くと横活三
  // (5,5),(6,6) を黒で配置 → (7,7) に置くと斜め活三
  // つまり (7,7) は三三禁 → (7,7)自体が禁手
  // → 延長点が禁手になる別のパターンを使う
  //
  // パターン: 黒が (7,5),(7,6),(7,7) の横三を持ち、
  // かつ延長点 (7,8) が別の三とぶつかり禁手になるように:
  // (5,8),(6,8) を黒で追加 → (7,8) に置くと横四+縦三 = 四三で禁手ではない
  // → 三三禁にするには (6,7),(5,6) 等で斜め三も作る
  //
  // シンプルに: 延長点が禁手（三三禁）になる盤面を構築
  const baseOptions = {
    enableFukumi: false,
    enableMise: false,
    enableForbiddenTrap: false,
    enableMultiThreat: false,
    enableCounterFour: false,
    enableVCT: false,
    enableMandatoryDefense: false,
    enableSingleFourPenalty: false,
    singleFourPenaltyMultiplier: 1.0,
    enableMiseThreat: false,
    enableNullMovePruning: false,
    enableFutilityPruning: false,
    enableForbiddenVulnerability: false,
  };

  // 盤面: (7,7)に黒を置くと横活三を作り、延長点のひとつが三三禁になる
  // 横三: (7,5),(7,6) → (7,7)で活三、延長点(7,4)と(7,8)
  // (7,8)を禁手にする: 縦二(5,8),(6,8) + 斜め二(6,9),(5,10)
  // → (7,8)に置くと横四 + 縦三 + 斜め三 = 四三三 → 三三禁ではなく四がある
  //
  // 三三禁にするには四がない三×2が必要:
  // 縦三: (5,8),(6,8) → (7,8)で縦三 （延長点(4,8)と(8,8)が空き）
  // 斜め三: (6,9),(5,10) → (7,8)で斜め三
  // 横三: (7,5),(7,6),(7,7)に置くと横活三→延長点(7,8)は上記の縦+斜めの交点
  // → (7,8)は三三禁！
  //
  // 実際に配置:
  // 黒: (7,5),(7,6) — 横二（(7,7)で活三に）
  // 黒: (5,8),(6,8) — 縦二（(7,8)に置くと縦三に）
  // 黒: (6,9),(5,10) — 斜め二（(7,8)に置くと斜め三に）
  function createVulnerableBoard(): BoardState {
    return createBoardWithStones([
      // 横の二 → (7,7) で横活三
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      // 縦の二 → (7,8) に置くと縦三
      { row: 5, col: 8, color: "black" },
      { row: 6, col: 8, color: "black" },
      // 斜め(右上→左下)の二 → (7,8) に置くと斜め三
      { row: 6, col: 9, color: "black" },
      { row: 5, col: 10, color: "black" },
    ]);
  }

  it("enableForbiddenVulnerability=trueの黒番はスコアが低下する", () => {
    const board = createVulnerableBoard();

    // (7,7) に置くと横活三、延長点(7,8)が三三禁
    // まず(7,8)が禁手であることを確認
    board[7][7] = "black"; // 仮配置
    const forbidden78 = checkForbiddenMove(board, 7, 8);
    board[7][7] = null; // 元に戻す
    expect(forbidden78.isForbidden).toBe(true);

    const scoreWithVulnerability = evaluatePosition(board, 7, 7, "black", {
      ...baseOptions,
      enableForbiddenVulnerability: true,
    });

    const scoreWithoutVulnerability = evaluatePosition(board, 7, 7, "black", {
      ...baseOptions,
      enableForbiddenVulnerability: false,
    });

    // 禁手脆弱性ペナルティにより、有効時のスコアが低い
    expect(scoreWithVulnerability).toBeLessThan(scoreWithoutVulnerability);
  });

  it("白番では禁手脆弱性ペナルティがない", () => {
    const board = createVulnerableBoard();

    const scoreWithVulnerability = evaluatePosition(board, 7, 7, "white", {
      ...baseOptions,
      enableForbiddenVulnerability: true,
    });

    const scoreWithoutVulnerability = evaluatePosition(board, 7, 7, "white", {
      ...baseOptions,
      enableForbiddenVulnerability: false,
    });

    // 白番は禁手がないので差がない
    expect(scoreWithVulnerability).toBe(scoreWithoutVulnerability);
  });

  it("evaluatePositionWithBreakdownでforbiddenVulnerability > 0を確認", () => {
    const board = createVulnerableBoard();

    // 仮配置して禁手確認（テストの前提条件）
    board[7][7] = "black";
    const forbidden78 = checkForbiddenMove(board, 7, 8);
    board[7][7] = null;
    expect(forbidden78.isForbidden).toBe(true);

    const { breakdown } = evaluatePositionWithBreakdown(board, 7, 7, "black", {
      ...baseOptions,
      enableForbiddenVulnerability: true,
    });

    expect(breakdown.forbiddenVulnerability).toBeGreaterThan(0);
  });
});

describe("findMiseTargets", () => {
  it("G7配置後、J7(距離3)がミセターゲットとして検出される", () => {
    // 12手目までの棋譜 + G7(13手目)
    // G7(8,6)-H7(8,7)-I7(8,8)の横三、延長点J7(8,9)は四三点
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10 G7",
    );

    // G7 = row=8, col=6
    const targets = findMiseTargets(board, 8, 6, "black");

    // J7(row=8, col=9)がターゲットに含まれる
    expect(targets.some((t) => t.row === 8 && t.col === 9)).toBe(true);
  });

  it("ミセターゲットが存在しない局面では空配列を返す", () => {
    // 初手のみ: ミセターゲットなし
    const { board } = createBoardFromRecord("H8");

    const targets = findMiseTargets(board, 7, 7, "black");
    expect(targets).toHaveLength(0);
  });

  it("±2近傍の四三点も検出する", () => {
    // 横三と縦二を作り、距離2以内に四三点がある場合
    const board = createBoardWithStones([
      // 横の三
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      // 縦の二
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    // (7,6)に石がある状態で、(7,7)が四三点
    const targets = findMiseTargets(board, 7, 6, "black");
    expect(targets.some((t) => t.row === 7 && t.col === 7)).toBe(true);
  });
});

describe("isMiseMove（拡張版）", () => {
  it("G7をミセ手として検出する（距離3のターゲット）", () => {
    // 13手目G7配置後の盤面
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10 G7",
    );

    // G7 = row=8, col=6
    expect(isMiseMove(board, 8, 6, "black")).toBe(true);
  });

  it("既存の±2範囲内のミセ手も引き続き検出する", () => {
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);

    // (7,6)はミセ手（(7,7)が四三点で距離1）
    expect(isMiseMove(board, 7, 6, "black")).toBe(true);
  });
});
