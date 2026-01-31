/**
 * 盤面評価関数のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import {
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
    expect(PATTERN_SCORES.THREE).toBe(100);
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
    });

    // enableMultiThreat無効時のスコア
    const scoreWithoutBonus = evaluatePosition(board, 7, 8, "black", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
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
    });

    const scoreWithoutBonus = evaluatePosition(board, 7, 8, "black", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
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
    });

    // enableCounterFour無効時のスコア
    const scoreWithoutCounter = evaluatePosition(board, 5, 8, "black", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
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
    });

    const scoreWithoutCounter = evaluatePosition(board, 5, 8, "black", {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
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
    // 倍率が1.05であることを確認（浮動小数点誤差を考慮）
    expect(diagonalScore / horizontalScore).toBeCloseTo(
      PATTERN_SCORES.DIAGONAL_BONUS_MULTIPLIER,
      2,
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
