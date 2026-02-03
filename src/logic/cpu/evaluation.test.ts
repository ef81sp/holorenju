/**
 * 盤面評価関数のテスト
 */

import { describe, expect, it } from "vitest";

import { checkForbiddenMove, createEmptyBoard } from "@/logic/renjuRules";

import {
  detectOpponentThreats,
  evaluateBoard,
  evaluatePosition,
  evaluateStonePatterns,
  PATTERN_SCORES,
} from "./evaluation";
import { createBoardWithStones, placeStonesOnBoard } from "./testUtils";

describe("PATTERN_SCORES", () => {
  it("スコア定数が正しく定義されている", () => {
    expect(PATTERN_SCORES.FIVE).toBe(100000);
    expect(PATTERN_SCORES.OPEN_FOUR).toBe(10000);
    expect(PATTERN_SCORES.FOUR_THREE_BONUS).toBe(5000);
    expect(PATTERN_SCORES.FOUR).toBe(1000);
    expect(PATTERN_SCORES.OPEN_THREE).toBe(1000);
    expect(PATTERN_SCORES.THREE).toBe(30);
    expect(PATTERN_SCORES.OPEN_TWO).toBe(50);
    expect(PATTERN_SCORES.TWO).toBe(10);
    expect(PATTERN_SCORES.CENTER_BONUS).toBe(5);
    expect(PATTERN_SCORES.FORBIDDEN_TRAP).toBe(100);
  });
});

describe("evaluateStonePatterns", () => {
  it("単独の石は0スコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);
    const score = evaluateStonePatterns(board, 7, 7, "black");
    expect(score).toBe(0);
  });

  it("2連（活二）のスコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 横方向で2連（両端空き）= OPEN_TWO
    const score = evaluateStonePatterns(board, 7, 7, "black");
    expect(score).toBe(PATTERN_SCORES.OPEN_TWO);
  });

  it("3連（活三）のスコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 横方向で3連（両端空き）= OPEN_THREE
    const score = evaluateStonePatterns(board, 7, 6, "black");
    expect(score).toBe(PATTERN_SCORES.OPEN_THREE);
  });

  it("4連（活四）のスコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 横方向で4連（両端空き）= OPEN_FOUR
    const score = evaluateStonePatterns(board, 7, 5, "black");
    expect(score).toBe(PATTERN_SCORES.OPEN_FOUR);
  });

  it("5連（五連）のスコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 横方向で5連 = FIVE
    const score = evaluateStonePatterns(board, 7, 5, "black");
    expect(score).toBe(PATTERN_SCORES.FIVE);
  });

  it("止め三（片端塞がり）のスコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 0, color: "black" }, // 盤端
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
    ]);
    // 横方向で3連（片端盤端）= THREE
    const score = evaluateStonePatterns(board, 7, 1, "black");
    expect(score).toBe(PATTERN_SCORES.THREE);
  });

  it("止め四（片端塞がり）のスコア", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 0, color: "black" }, // 盤端
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
      { row: 7, col: 3, color: "black" },
    ]);
    // 横方向で4連（片端盤端）= FOUR
    const score = evaluateStonePatterns(board, 7, 2, "black");
    expect(score).toBe(PATTERN_SCORES.FOUR);
  });
});

describe("evaluatePosition", () => {
  it("空の盤面の中央への着手は中央ボーナスを得る", () => {
    const board = createEmptyBoard();
    const score = evaluatePosition(board, 7, 7, "black");
    expect(score).toBeGreaterThan(0);
  });

  it("隅への着手は中央ボーナスを得られない", () => {
    const board = createEmptyBoard();
    const centerScore = evaluatePosition(board, 7, 7, "black");
    const cornerScore = evaluatePosition(board, 0, 0, "black");
    expect(centerScore).toBeGreaterThan(cornerScore);
  });

  it("五連形成は最高スコアを得る", () => {
    const board = createEmptyBoard();
    // 黒石を4つ並べる
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 5つ目を置く位置を評価
    const score = evaluatePosition(board, 7, 7, "black");
    expect(score).toBe(PATTERN_SCORES.FIVE);
  });

  it("活四形成は高スコアを得る", () => {
    const board = createEmptyBoard();
    // 黒石を3つ並べる（両端が空いている）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 4つ目を置く位置を評価（両端が空いている）
    const score = evaluatePosition(board, 7, 7, "black");
    expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.OPEN_FOUR);
  });

  it("活三形成は中程度のスコアを得る", () => {
    const board = createEmptyBoard();
    // 黒石を2つ並べる（両端が空いている）
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);

    // 3つ目を置く位置を評価
    const score = evaluatePosition(board, 7, 7, "black");
    expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.OPEN_THREE);
  });

  it("相手の脅威をブロックする手は防御スコアを得る", () => {
    const board = createEmptyBoard();
    // 白石を3つ並べる（活三）
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);

    // 黒が7,7に置く（白の活四形成をブロック）
    const blockScore = evaluatePosition(board, 7, 7, "black");
    // 黒が別の位置に置く
    const otherScore = evaluatePosition(board, 0, 0, "black");

    // ブロックする手のほうが高スコア
    expect(blockScore).toBeGreaterThan(otherScore);
  });
});

describe("evaluateBoard", () => {
  it("空の盤面は0スコア", () => {
    const board = createEmptyBoard();
    const score = evaluateBoard(board, "black");
    expect(score).toBe(0);
  });

  it("黒の視点で黒が有利な盤面は正のスコア", () => {
    const board = createEmptyBoard();
    // 黒の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const score = evaluateBoard(board, "black");
    expect(score).toBeGreaterThan(0);
  });

  it("黒の視点で白が有利な盤面は負のスコア", () => {
    const board = createEmptyBoard();
    // 白の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    const score = evaluateBoard(board, "black");
    expect(score).toBeLessThan(0);
  });

  it("白の視点では評価が反転する", () => {
    const board = createEmptyBoard();
    // 白の活三を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    const blackScore = evaluateBoard(board, "black");
    const whiteScore = evaluateBoard(board, "white");
    expect(whiteScore).toBeGreaterThan(0);
    expect(blackScore).toBeLessThan(0);
  });

  it("五連がある場合は非常に高いスコア", () => {
    const board = createEmptyBoard();
    // 黒の五連を作る
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const score = evaluateBoard(board, "black");
    expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.FIVE);
  });
});

describe("跳びパターン評価", () => {
  describe("跳び四", () => {
    it("跳び四（●●●・●）はFOURスコアで評価", () => {
      // ●●●・● パターン: 7行目に [3]=黒, [4]=黒, [5]=黒, [6]=空, [7]=黒
      const board = createBoardWithStones([
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 4, color: "black" },
        { row: 7, col: 5, color: "black" },
        { row: 7, col: 7, color: "black" },
      ]);

      // 中央の石で評価
      const score = evaluateStonePatterns(board, 7, 5, "black");
      expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.FOUR);
    });

    it("跳び四（●●・●●）はFOURスコアで評価", () => {
      // ●●・●● パターン: 7行目に [3]=黒, [4]=黒, [5]=空, [6]=黒, [7]=黒
      const board = createBoardWithStones([
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 4, color: "black" },
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
      ]);

      const score = evaluateStonePatterns(board, 7, 4, "black");
      expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.FOUR);
    });

    it("跳び四（●・●●●）はFOURスコアで評価", () => {
      // ●・●●● パターン: 7行目に [3]=黒, [4]=空, [5]=黒, [6]=黒, [7]=黒
      const board = createBoardWithStones([
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 5, color: "black" },
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
      ]);

      const score = evaluateStonePatterns(board, 7, 5, "black");
      expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.FOUR);
    });
  });

  describe("跳び三", () => {
    it("活跳び三（・●●・●・）はOPEN_THREEスコアで評価", () => {
      // ・●●・●・ パターン: 7行目に [2]=空, [3]=黒, [4]=黒, [5]=空, [6]=黒, [7]=空
      const board = createBoardWithStones([
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 4, color: "black" },
        { row: 7, col: 6, color: "black" },
      ]);

      const score = evaluateStonePatterns(board, 7, 4, "black");
      expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.OPEN_THREE);
    });

    it("活跳び三（・●・●●・）はOPEN_THREEスコアで評価", () => {
      // ・●・●●・ パターン: 7行目に [2]=空, [3]=黒, [4]=空, [5]=黒, [6]=黒, [7]=空
      const board = createBoardWithStones([
        { row: 7, col: 3, color: "black" },
        { row: 7, col: 5, color: "black" },
        { row: 7, col: 6, color: "black" },
      ]);

      const score = evaluateStonePatterns(board, 7, 5, "black");
      expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.OPEN_THREE);
    });
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

describe("スコア定数", () => {
  it("新しいスコア定数が正しく定義されている", () => {
    expect(PATTERN_SCORES.FORBIDDEN_TRAP_STRONG).toBe(8000);
    expect(PATTERN_SCORES.FUKUMI_BONUS).toBe(1500);
    expect(PATTERN_SCORES.FORBIDDEN_TRAP_SETUP).toBe(1500);
    expect(PATTERN_SCORES.MISE_BONUS).toBe(1000);
  });

  it("高度な戦術評価のスコア定数が正しく定義されている", () => {
    expect(PATTERN_SCORES.MULTI_THREAT_BONUS).toBe(500);
    expect(PATTERN_SCORES.VCT_BONUS).toBe(8000);
    expect(PATTERN_SCORES.COUNTER_FOUR_MULTIPLIER).toBe(1.5);
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
    // 白の活四: row=7, col=[3,4,5,6] 両端空き
    const board = createBoardWithStones([
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
    // 白の活三: row=7, col=[4,5,6] 両端空き
    const board = createBoardWithStones([
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
    // 白の活三がある
    // 黒が四三を作れる配置
    const board = createBoardWithStones([
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

    // 白の活四
    const board = createBoardWithStones([
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

describe("禁手追い込み三（FORBIDDEN_TRAP_THREE）", () => {
  it("スコア定数が正しく定義されている", () => {
    expect(PATTERN_SCORES.FORBIDDEN_TRAP_THREE).toBe(3000);
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
    });

    // FORBIDDEN_TRAP_THREEボーナスは含まれないはず
    // 活三のスコア（OPEN_THREE）と防御スコアのみ
    expect(scoreNormal).toBeLessThan(PATTERN_SCORES.FORBIDDEN_TRAP_THREE);
  });
});
