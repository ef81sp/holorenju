import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import {
  checkDraw,
  checkFive,
  checkForbiddenMove,
  checkForbiddenMoveWithContext,
  checkJumpFour,
  checkJumpThree,
  checkWin,
  copyBoard,
  createEmptyBoard,
  DRAW_MOVE_LIMIT,
  isValidPosition,
  recognizePattern,
} from "./renjuRules";

describe("isValidPosition（位置の有効性判定）", () => {
  it("有効な位置に対してtrueを返す", () => {
    expect(isValidPosition(0, 0)).toBe(true);
    expect(isValidPosition(7, 7)).toBe(true);
    expect(isValidPosition(14, 14)).toBe(true);
  });

  it("盤外の位置に対してfalseを返す", () => {
    expect(isValidPosition(-1, 0)).toBe(false);
    expect(isValidPosition(0, -1)).toBe(false);
    expect(isValidPosition(15, 0)).toBe(false);
    expect(isValidPosition(0, 15)).toBe(false);
    expect(isValidPosition(15, 15)).toBe(false);
  });
});

describe("createEmptyBoard（空盤面の生成）", () => {
  it("nullで埋められた15x15の盤面を生成する", () => {
    const board = createEmptyBoard();
    expect(board).toHaveLength(15);
    expect(board[0]).toHaveLength(15);
    expect(board.every((row) => row.every((cell) => cell === null))).toBe(true);
  });
});

describe("copyBoard（盤面のコピー）", () => {
  it("盤面のディープコピーを生成する", () => {
    const original = createEmptyBoard();
    original[7][7] = "black";

    const copied = copyBoard(original);
    copied[7][7] = "white";

    expect(original[7][7]).toBe("black");
    expect(copied[7][7]).toBe("white");
  });
});

describe("checkFive（五連の検出）", () => {
  it("横方向の五連を検出する", () => {
    const board = createEmptyBoard();
    // 横に4つの黒石を配置
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";

    // (7, 9) に置くと五連完成
    expect(checkFive(board, 7, 9, "black")).toBe(true);
    // (7, 4) に置いても五連完成
    expect(checkFive(board, 7, 4, "black")).toBe(true);
  });

  it("縦方向の五連を検出する", () => {
    const board = createEmptyBoard();
    board[3][7] = "black";
    board[4][7] = "black";
    board[5][7] = "black";
    board[6][7] = "black";

    expect(checkFive(board, 7, 7, "black")).toBe(true);
    expect(checkFive(board, 2, 7, "black")).toBe(true);
  });

  it("斜め方向の五連を検出する", () => {
    const board = createEmptyBoard();
    board[3][3] = "black";
    board[4][4] = "black";
    board[5][5] = "black";
    board[6][6] = "black";

    expect(checkFive(board, 7, 7, "black")).toBe(true);
    expect(checkFive(board, 2, 2, "black")).toBe(true);
  });

  it("四連のみの場合はfalseを返す", () => {
    const board = createEmptyBoard();
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";

    expect(checkFive(board, 7, 8, "black")).toBe(false);
  });

  it("六連（長連）の場合はfalseを返す", () => {
    const board = createEmptyBoard();
    board[7][4] = "black";
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";

    // これは6連になるので、ちょうど5連ではない
    expect(checkFive(board, 7, 9, "black")).toBe(false);
  });
});

describe("checkWin（勝利判定）", () => {
  it("最後の手で勝利条件を検出する", () => {
    const board = createEmptyBoard();
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";
    board[7][9] = "black";

    expect(checkWin(board, { row: 7, col: 7 }, "black")).toBe(true);
  });

  it("五連がない場合はfalseを返す", () => {
    const board = createEmptyBoard();
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";

    expect(checkWin(board, { row: 7, col: 7 }, "black")).toBe(false);
  });
});

describe("checkForbiddenMove（禁手判定）", () => {
  describe("長連禁", () => {
    it("長連を禁手として検出する", () => {
      const board = createEmptyBoard();
      // 5連が既にあり、6つ目を置くと長連になる
      board[7][4] = "black";
      board[7][5] = "black";
      board[7][6] = "black";
      board[7][7] = "black";
      board[7][8] = "black";

      const result = checkForbiddenMove(board, 7, 9);
      expect(result.isForbidden).toBe(true);
      expect(result.type).toBe("overline");
    });
  });

  describe("三三禁", () => {
    it("三三を禁手として検出する", () => {
      const board = createEmptyBoard();
      // 石を置くと2つの活三ができる位置を作る
      // 横方向の活二
      board[7][6] = "black";
      board[7][8] = "black";
      // 縦方向の活二
      board[6][7] = "black";
      board[8][7] = "black";

      const result = checkForbiddenMove(board, 7, 7);
      expect(result.isForbidden).toBe(true);
      expect(result.type).toBe("double-three");
    });
  });

  describe("四四禁", () => {
    it("四四を禁手として検出する", () => {
      const board = createEmptyBoard();
      // 石を置くと2つの四ができる位置を作る
      // 横方向: row=7, cols 5,6,_,8 に ● ● ・ ●
      board[7][5] = "black";
      board[7][6] = "black";
      board[7][8] = "black";
      // 縦方向: col=7, rows 5,6,_,8 に ● ● ・ ●
      board[5][7] = "black";
      board[6][7] = "black";
      board[8][7] = "black";

      // (7, 7) に置くと2つの四ができる
      const result = checkForbiddenMove(board, 7, 7);
      expect(result.isForbidden).toBe(true);
      expect(result.type).toBe("double-four");
    });
  });

  describe("五連優先", () => {
    it("五連ができる手は三三パターンでも禁手にならない", () => {
      const board = createEmptyBoard();
      // 五連になる位置を作る（三三パターンも含む）
      board[7][3] = "black";
      board[7][4] = "black";
      board[7][5] = "black";
      board[7][6] = "black";

      // (7, 7) に置くと五連になるので禁手ではない
      const result = checkForbiddenMove(board, 7, 7);
      expect(result.isForbidden).toBe(false);
    });
  });

  it("パターンのない空き位置は禁手ではない", () => {
    const board = createEmptyBoard();
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false);
    expect(result.type).toBeNull();
  });

  it("既に石がある位置は禁手ではない", () => {
    const board = createEmptyBoard();
    board[7][7] = "black";

    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false);
  });
});

describe("飛び三の検出", () => {
  it("・●*・●・ パターン（置くと飛び三●*・●になる）で三々禁になる", () => {
    const board = createEmptyBoard();
    // 横方向: 置いた後に ・●●・●・ の飛び三になる
    // row=7, col=6に置く
    // col 4は空き, col 5に黒石, col 6が置く位置, col 7は空き, col 8に黒石, col 9は空き
    board[7][5] = "black"; // col 5: 1つ目の石
    // col 6 が置く位置
    // col 7 は空き（飛びの空き）
    board[7][8] = "black"; // col 8: 2つ目の石
    // 置いた後: ・●●・●・ → 飛び三

    // 縦方向: 普通の三 (両端開) - col 6
    board[5][6] = "black";
    board[6][6] = "black";
    // 置いた後: ・●●●・ → 普通の三

    // (7,6) に置くと横に飛び三(●●・●) + 縦に普通の三(●●●) = 三々禁
    const result = checkForbiddenMove(board, 7, 6);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("・●・*●・ パターン（置くと飛び三●・●●になる）で三々禁になる", () => {
    const board = createEmptyBoard();
    // 横方向: 置いた後に ・●・●●・ の飛び三になる
    // row=7, col=7に置く
    // col 4は空き, col 5に黒石, col 6は空き（飛びの空き）, col 7が置く位置, col 8に黒石, col 9は空き
    board[7][5] = "black"; // col 5: 1つ目の石
    // col 6 は空き（飛びの空き）
    // col 7 が置く位置
    board[7][8] = "black"; // col 8: 2つ目の石
    // 置いた後: ・●・●●・ → 飛び三

    // 縦方向: 普通の三 (両端開) - col 7
    board[5][7] = "black";
    board[6][7] = "black";
    // 置いた後: ・●●●・ → 普通の三

    // (7,7) に置くと横に飛び三(●・●●) + 縦に普通の三(●●●) = 三々禁
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("・●●・*・ パターン（置くと飛び三●●・●になる）で三々禁になる", () => {
    const board = createEmptyBoard();
    // 横方向: 置いた後に ・●●・●・ の飛び三になる
    board[7][6] = "black";
    board[7][7] = "black";

    // 斜め方向: 普通の三 (両端開)
    board[8][8] = "black";
    board[9][7] = "black";

    // (7,9) に置くと横に飛び三(●●・●) + 斜めに普通の三(●●●) = 三々禁
    const result = checkForbiddenMove(board, 7, 9);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("斜め方向の・●●・*・パターンでも三々禁になる", () => {
    const board = createEmptyBoard();
    // 斜め右方向(↘): 置いた後に ・●●・●・ の飛び三になる
    // (5,5)と(6,6)が2石、(7,7)が空き(ギャップ)、(8,8)が置く位置
    board[5][5] = "black";
    board[6][6] = "black";

    // 横方向: 普通の三 (両端開)
    board[8][6] = "black";
    board[8][7] = "black";

    // (8,8) に置くと斜めに飛び三(●●・●) + 横に普通の三(●●●) = 三々禁
    const result = checkForbiddenMove(board, 8, 8);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("縦方向の・●●・*・パターンでも三々禁になる", () => {
    const board = createEmptyBoard();
    // 縦方向: 置いた後に ・●●・●・ の飛び三になる
    // (5,7)と(6,7)が2石、(7,7)が空き(ギャップ)、(8,7)が置く位置
    board[5][7] = "black";
    board[6][7] = "black";

    // 横方向: 普通の三 (両端開)
    board[8][5] = "black";
    board[8][6] = "black";

    // (8,7) に置くと縦に飛び三(●●・●) + 横に普通の三(●●●) = 三々禁
    const result = checkForbiddenMove(board, 8, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("飛び三が2つで三々禁になる", () => {
    const board = createEmptyBoard();
    // 横方向: ・●*・●・ (row=6, cols 5=石, 6=置く, 7=空, 8=石) - 飛び三になる
    board[6][5] = "black";
    // col=6, row=6 が置く位置
    // col=7 は空き（飛びの空き）
    board[6][8] = "black";
    // 縦方向: ・●*・●・ (col=6, rows 5=石, 6=置く, 7=空, 8=石) - 飛び三になる
    board[5][6] = "black";
    // row=6, col=6 が置く位置
    // row=7 は空き（飛びの空き）
    board[8][6] = "black";

    // (6,6) に置くと横に飛び三(●●・●) + 縦に飛び三(●●・●) = 三々禁
    const result = checkForbiddenMove(board, 6, 6);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("片端が塞がれた飛び三は三としてカウントしない", () => {
    const board = createEmptyBoard();
    // 横方向: 白●●・*●・ (row=7) - 片端塞がれている
    board[7][3] = "white";
    board[7][4] = "black";
    board[7][5] = "black";
    // col=6 は空き, col=7 が置く位置
    board[7][8] = "black";
    // 縦方向: 普通の三（両端開いている）
    board[5][7] = "black";
    board[6][7] = "black";
    // row=7 に置く位置, row 8,9 は開いている

    // 横方向の飛び三は左端が塞がれているので三としてカウントしない
    // 縦方向だけが有効な三なので、三々禁ではない
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false);
  });
});

describe("ウソの三の判定", () => {
  it("達四点が四四禁なら三として認定しない", () => {
    const board = createEmptyBoard();
    // 設定: 見かけ上の三々だが、片方の三の達四点が四四禁で塞がれている
    //
    // 横方向: ・●●*・ (row=7, cols 5,6=石, 7=置く) - 見かけ上の三
    board[7][5] = "black";
    board[7][6] = "black";
    // col=7 が置く位置
    // この三の達四点は col=4 または col=8
    // col=8 が四四禁になるように配置

    // 縦方向: ・●●*・ (col=7, rows 5,6=石, 7=置く) - 見かけ上の三
    board[5][7] = "black";
    board[6][7] = "black";

    // col=8 を四四禁にする配置:
    // 横方向の石は使わない（col=4の達四に影響するため）
    // 縦方向に四を作る: (7,8)に置くと縦に●●●●になる
    board[5][8] = "black";
    board[6][8] = "black";
    board[8][8] = "black";
    // 斜め(↗)方向にも四を作る: (7,8)に置くと斜めに●●●●になる
    board[6][9] = "black";
    board[5][10] = "black";
    board[4][11] = "black";
    // これで (7,8) は四四禁点（縦+斜め+横の3方向に四）

    // しかし col=4 は開いているので、三は有効
    // 結果: 二つの三が両方とも有効なら三々禁

    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("達四点がすべて禁点なら三として認定しない（長連禁で塞がれる場合）", () => {
    const board = createEmptyBoard();
    // ウソの三のシンプルなテスト:
    // 横方向に見かけ上の三があるが、達四点（三を四にできる点）がすべて長連禁

    // 盤面: row=7
    // cols: 1  2  3  4  5  6  7  8  9  10 11 12 13
    //       ● ● ● ●  ・ ● *  ・ ● ● ●  ●  ・
    //
    // col=7 に置くと、左に4連(1-4)、右に4連(9-12)がある
    // この状態で col=5,6,7 が三のように見えるが、
    // 達四点の col=4 に置くと ●●●●●●・●●●● で長連（6連）
    // 達四点の col=8 に置くと ●●●●・●●●●●● で長連（6連）
    // よってこれはウソの三

    board[7][1] = "black";
    board[7][2] = "black";
    board[7][3] = "black";
    board[7][4] = "black";
    // col=5 は空き
    board[7][6] = "black";
    // col=7 が置く位置
    // col=8 は空き
    board[7][9] = "black";
    board[7][10] = "black";
    board[7][11] = "black";
    board[7][12] = "black";

    // 縦方向に本物の三を作る
    board[5][7] = "black";
    board[6][7] = "black";
    // row=7 が置く位置

    // 横方向の三の達四点 col=5 と col=8 はどちらも長連禁
    // よって横方向の三はウソの三
    // 縦方向だけが本物の三なので、三々禁ではない

    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false);
  });

  it("達四点が四四禁で塞がれた三はウソの三", () => {
    const board = createEmptyBoard();
    // 横方向に見かけ上の三: ・●●*・ (row=7, cols 5,6=黒, 7=置く)
    // 達四点 col=4 と col=8

    // 縦方向に見かけ上の三: ・●●*・ (col=7, rows 5,6=黒, 7=置く)
    // 達四点 row=4 と row=8

    // col=8 を四四禁にする:
    // (7,8) に置くと四四禁になるように配置

    // まず基本の二つの三
    board[7][5] = "black";
    board[7][6] = "black";
    board[5][7] = "black";
    board[6][7] = "black";

    // (7,8) が四四禁になるように配置:
    // 横方向の石は使わない（col=4の達四に影響するため）
    // 縦方向に四を作る: (7,8)に置くと縦に●●●●になる
    board[5][8] = "black";
    board[6][8] = "black";
    board[8][8] = "black";
    // 斜め(↗)方向にも四を作る: (7,8)に置くと斜めに●●●●になる
    board[6][9] = "black";
    board[5][10] = "black";
    board[4][11] = "black";

    // (7,8) は四四禁点（縦+斜め+横の3方向に四）
    // しかし (7,4) は開いているので、横の三は有効
    // 結果: 三々禁

    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("達四点が1つでも有効なら三として認定", () => {
    const board = createEmptyBoard();
    // 二つの活三がどちらも有効な達四点を持っている

    // 横の三: ・●●*・ (row=7, cols 5,6=黒, 7=置く)
    // 達四点は col=4 と col=8、両方開いている
    board[7][5] = "black";
    board[7][6] = "black";

    // 縦の三: ・●●*・ (col=7, rows 5,6=黒, 7=置く)
    // 達四点は row=4 と row=8、両方開いている
    board[5][7] = "black";
    board[6][7] = "black";

    // 結果: 両方とも三として認定されるので三々禁
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });
});

describe("否三々の判定", () => {
  it("循環参照がない通常の三々は禁手", () => {
    const board = createEmptyBoard();
    // シンプルな三々: 横と縦に三ができる
    board[7][5] = "black";
    board[7][6] = "black";
    board[5][7] = "black";
    board[6][7] = "black";

    // (7,7) に置くと三々禁
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("相互参照する否三々ケース", () => {
    // 否三々パターン:
    // 点Aと点Bが相互に参照し合う
    //
    // 盤面イメージ (row=5,6,7,8,9 x col=3,4,5,6,7,8,9,10,11):
    //
    //       3  4  5  6  7  8  9 10 11
    //    5  ・ ・ ・ ● ・ ● ・ ・ ・
    //    6  ・ ・ ● ・ ・ ・ ● ・ ・
    //    7  ・ ● ・ ・A ・ ・ ・ ● ・
    //    8  ・ ・ ● ・ ・ ・ ● ・ ・
    //    9  ・ ・ ・ ● ・ ● ・ ・ ・
    //
    // Aは(7,7)に置く点
    // 横方向に ●・・A・・・● → 飛び三になりそうだが達四点は?
    // 縦方向に ●・・A・・・● → 飛び三になりそうだが達四点は?
    //
    // これはシンプルな飛び三にならないので、別のパターンを使う

    const board = createEmptyBoard();

    // 単純な否三々の例:
    // 両方の三の達四点が相互に三々禁になるケース
    //
    // 設計:
    // - 点A(7,7)に置くと横の三と縦の三ができる
    // - 横の三の達四点B(7,8)
    // - 縦の三の達四点C(8,7)
    // - Bに置くと三々になる → Bは禁点
    // - Cに置くと三々になる → Cは禁点
    // - しかしBの三々判定で達四点にAが含まれ、
    //   Aの判定でBが含まれる → 循環参照 → 否三々

    // 実装: より簡単な相互参照パターン
    // 点A(7,7)の横の三の達四点B(7,4)
    // 点Bの三々判定で達四点にAが含まれる構造

    // 横の三: ・●●A・ (cols 4,5,6=空,黒,黒, 7=A)
    board[7][5] = "black";
    board[7][6] = "black";
    // 達四点は (7,4) と (7,8)

    // 縦の三: ・●●A・ (rows 4,5,6=空,黒,黒, 7=A)
    board[5][7] = "black";
    board[6][7] = "black";
    // 達四点は (4,7) と (8,7)

    // (7,4) を三々禁にする:
    // (7,4)に置くと、横にできる三の達四点が(7,7)を含むようにする
    // → (7,7)の判定を行うと循環参照が起きる

    // (7,4)の横の三: 既存の(7,5)(7,6)を使う
    // 達四点は(7,3)と(7,7)←これがA

    // (7,4)の縦の三を作る:
    board[5][4] = "black";
    board[6][4] = "black";
    // (7,4)に置くと縦の三ができる
    // 達四点は(4,4)と(8,4)

    // この時点で:
    // - A(7,7)に置くと横の三と縦の三
    // - 横の三の達四点(7,4)に置くと、横の三と縦の三ができる
    // - しかし横の三の達四点に(7,7)が含まれる
    // → 循環参照: A→(7,4)→A

    // 結果: Aの横の三の達四点(7,4)を検証→(7,4)の横の三の達四点(7,7)を検証
    // → (7,7)は判定中なので「禁点ではない」→(7,4)は禁点ではない
    // → Aの横の三は有効

    // これは否三々にはならない（通常の三々禁）

    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("両方の三の達四点がすべて禁点で塞がれるケース（ウソの三）", () => {
    const board = createEmptyBoard();

    // ウソの三のテスト:
    // 点Aに置くと2つの三ができるが、
    // 片方の三の達四点がすべて禁点（長連禁など）で塞がれている場合

    // 横方向: ●●●● ・ ● A ・ ●●●●
    // 達四点は両側とも長連禁
    board[7][0] = "black";
    board[7][1] = "black";
    board[7][2] = "black";
    board[7][3] = "black";
    // col=4 は空き（達四点だが長連禁）
    board[7][5] = "black";
    // col=6 は空き
    // col=7 がA（置く位置）
    // col=8 は空き（達四点だが長連禁）
    board[7][9] = "black";
    board[7][10] = "black";
    board[7][11] = "black";
    board[7][12] = "black";

    // 縦方向の三: ・●●A・
    board[5][7] = "black";
    board[6][7] = "black";
    // row=7 がA
    // 達四点は(4,7)と(8,7)、どちらも開いている

    // Aに置くと:
    // - 横方向は三のように見えるが、達四点(7,4)と(7,8)は両方長連禁
    //   → ウソの三
    // - 縦方向は三で、達四点は開いている
    //   → 本物の三

    // 本物の三が1つだけなので、三々禁ではない
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false);
  });

  it("否三々の真のケース（相互参照する循環で禁手にならない）", () => {
    const board = createEmptyBoard();

    // 否三々の真のケース:
    // 点Aに置くと2つの飛び三ができるが、
    // 両方の飛び三の達四点(B, C)がそれぞれ三々禁点であり、
    // かつその三々判定で達四点としてAを参照する。
    // 循環参照により、Aは「禁点ではない」として扱われるため、
    // B, Cの三は有効となり三々禁点になる。
    // しかしAから見ると、達四点B, Cが禁点なので両方の飛び三が無効（ウソの三）。
    // 結果: 有効な三が0個なので、Aは三々禁ではない。

    // A = (7,7) に置くと2つの飛び三ができる

    // 横飛び三: ・●・A●・ (cols 4,5,6,7,8,9)
    // col5=●, col6=空き, col7=A, col8=●
    board[7][5] = "black";
    board[7][8] = "black";
    // Aに置くと ・●・●●・ → 飛び三、達四点は(7,6)=B

    // 縦飛び三: ・●・A●・ (rows 4,5,6,7,8,9)
    // row5=●, row6=空き, row7=A, row8=●
    board[5][7] = "black";
    board[8][7] = "black";
    // Aに置くと ・●・●●・ → 飛び三、達四点は(6,7)=C

    // B = (7,6) を三々禁点にする
    // Bの横飛び三: (7,5), B, (7,8) → 達四点は(7,7)=A ← 循環参照ポイント
    // Bの縦三: (5,6), (6,6), B → 達四点は(4,6)と(8,6)
    board[5][6] = "black";
    board[6][6] = "black";

    // C = (6,7) を三々禁点にする
    // Cの縦飛び三: (5,7), C, (8,7) → 達四点は(7,7)=A ← 循環参照ポイント
    // Cの横三: (6,5), (6,6), C → 達四点は(6,4)と(6,8)
    board[6][5] = "black";
    // board[6][6] は既に設定済み

    // 判定フロー:
    // 1. A(7,7)の判定開始、inProgress = {A}
    // 2. Aの横飛び三の達四点B(7,6)を検証
    // 3. B(7,6)の判定開始、inProgress = {A, B}
    // 4. Bの横飛び三の達四点A(7,7)を検証
    // 5. A(7,7)はinProgressにある → 「禁点ではない」
    // 6. Bの横飛び三は有効（達四点Aが禁点ではない）
    // 7. Bの縦三の達四点(4,6)を検証 → 禁点ではない
    // 8. Bの縦三は有効
    // 9. B(7,6)は三々禁点（2つの有効な三）
    // 10. → Aの横飛び三は無効（達四点Bが禁点）
    // 11. 同様にC(6,7)も三々禁点
    // 12. → Aの縦飛び三も無効（達四点Cが禁点）
    // 13. Aの有効な三 = 0
    // 14. A(7,7)は三々禁ではない！

    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false); // 否三々で禁手にならない！
  });
});

describe("飛び四の検出", () => {
  it("●●●・● パターン（空きに置く）で五連になるので禁手ではない", () => {
    const board = createEmptyBoard();
    // 横方向: ・●●●*●・ (row=7, cols 4,5,6=石, 7=置く, 8=石)
    // 置いた後: ●●●●● → 五連になるので禁手ではない
    board[7][4] = "black";
    board[7][5] = "black";
    board[7][6] = "black";
    // col=7 が置く位置
    board[7][8] = "black";

    // これは五連になるので禁手ではない
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false);
  });

  it("●●・●● パターン（空きに置く）で五連になるので禁手ではない", () => {
    const board = createEmptyBoard();
    // 横方向: ・●●*●●・ (row=7, cols 4,5=石, 6=置く, 7,8=石)
    // 置いた後: ●●●●● → 五連になるので禁手ではない
    board[7][4] = "black";
    board[7][5] = "black";
    // col=6 が置く位置
    board[7][7] = "black";
    board[7][8] = "black";

    // これは五連になるので禁手ではない
    const result = checkForbiddenMove(board, 7, 6);
    expect(result.isForbidden).toBe(false);
  });

  it("飛び四が2方向で四四禁になる", () => {
    const board = createEmptyBoard();
    // (7,7) に置く
    // 横方向に飛び四: ●●*・● (row=7, cols 5,6=石, 7=置く, 8=空, 9=石)
    // これは置いた後 ●●●・● で飛び四になる
    board[7][5] = "black";
    board[7][6] = "black";
    // col=7 が置く位置
    // col=8 は空き（飛びの空き）
    board[7][9] = "black";
    // 縦方向に飛び四: ●●*・● (col=7, rows 5,6=石, 7=置く, 8=空, 9=石)
    board[5][7] = "black";
    board[6][7] = "black";
    // row=7 が置く位置
    // row=8 は空き（飛びの空き）
    board[9][7] = "black";

    // (7,7) に置くと横に飛び四(●●●・●) + 縦に飛び四(●●●・●) = 四四禁
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-four");
  });

  it("連続四と飛び四で四四禁になる", () => {
    const board = createEmptyBoard();
    // (7,7) に置く
    // 横方向に連続四: ●●●* (row=7, cols 4,5,6=石, 7=置く)
    board[7][4] = "black";
    board[7][5] = "black";
    board[7][6] = "black";
    // col=7 が置く位置
    // 縦方向に飛び四: ●●*・● (col=7, rows 5,6=石, 7=置く, 8=空, 9=石)
    board[5][7] = "black";
    board[6][7] = "black";
    // row=7 が置く位置
    // row=8 は空き（飛びの空き）
    board[9][7] = "black";

    // (7,7) に置くと横に連続四(●●●●) + 縦に飛び四(●●●・●) = 四四禁
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-four");
  });
});

describe("recognizePattern（パターン認識）", () => {
  it("五連を認識する", () => {
    const board = createEmptyBoard();
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";

    const patterns = recognizePattern(board, 7, 9, "black");
    expect(patterns.some((p) => p.type === "five")).toBe(true);
  });

  it("活三を認識する", () => {
    const board = createEmptyBoard();
    // ・●●・ パターン - col=8に置くと活三
    board[7][6] = "black";
    board[7][7] = "black";

    const patterns = recognizePattern(board, 7, 8, "black");
    expect(patterns.some((p) => p.type === "open-three")).toBe(true);
  });

  it("活四を認識する", () => {
    const board = createEmptyBoard();
    // ・●●●・ パターン - 置くと活四になる
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";

    const patterns = recognizePattern(board, 7, 8, "black");
    expect(patterns.some((p) => p.type === "open-four")).toBe(true);
  });

  it("長連を認識する", () => {
    const board = createEmptyBoard();
    board[7][4] = "black";
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";

    const patterns = recognizePattern(board, 7, 9, "black");
    expect(patterns.some((p) => p.type === "overline")).toBe(true);
  });

  it("パターンがない場合は空配列を返す", () => {
    const board = createEmptyBoard();
    board[7][7] = "black";

    const patterns = recognizePattern(board, 7, 8, "black");
    expect(patterns).toHaveLength(0);
  });
});

describe("斜め方向の禁手", () => {
  it("斜め(↘)+縦で三三禁になる", () => {
    const board = createEmptyBoard();
    // 斜め方向（右下↘）: (5,5), (6,6) に置いて (7,7) に置く
    board[5][5] = "black";
    board[6][6] = "black";
    // 縦方向: (5,7), (6,7) に置いて (7,7) に置く
    board[5][7] = "black";
    board[6][7] = "black";

    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("斜め(↘)+横で三三禁になる", () => {
    const board = createEmptyBoard();
    // 斜め方向（右下↘）: (5,5), (6,6) に置いて (7,7) に置く
    board[5][5] = "black";
    board[6][6] = "black";
    // 横方向: (7,5), (7,6) に置いて (7,7) に置く
    board[7][5] = "black";
    board[7][6] = "black";

    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("斜め(↘)+斜め(↙)で三三禁になる", () => {
    const board = createEmptyBoard();
    // 斜め方向（右下↘）: (5,5), (6,6) に置いて (7,7) に置く
    board[5][5] = "black";
    board[6][6] = "black";
    // 斜め方向（左下↙）: (5,9), (6,8) に置いて (7,7) に置く
    board[5][9] = "black";
    board[6][8] = "black";

    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("斜め(↘)+斜め(↙)で四四禁になる", () => {
    const board = createEmptyBoard();
    // 斜め方向（右下↘）: (4,4), (5,5), (6,6) に置いて (7,7) に置く
    board[4][4] = "black";
    board[5][5] = "black";
    board[6][6] = "black";
    // 斜め方向（左下↙）: (4,10), (5,9), (6,8) に置いて (7,7) に置く
    board[4][10] = "black";
    board[5][9] = "black";
    board[6][8] = "black";

    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-four");
  });
});

describe("盤端のエッジケース", () => {
  it("盤端での三は自動的に片側が塞がれるため三三禁にならない", () => {
    const board = createEmptyBoard();
    // 横方向: col=0,1 に石を置き col=2 に置く（左端が盤外で塞がれる）
    board[7][0] = "black";
    board[7][1] = "black";
    // col=2 に置いても活三にならない（左端が塞がれている）

    // 縦方向に活三を作る
    board[5][2] = "black";
    board[6][2] = "black";

    // 横は止め三（盤端で塞がれ）、縦は活三 → 三三禁ではない
    const result = checkForbiddenMove(board, 7, 2);
    expect(result.isForbidden).toBe(false);
  });

  it("盤端(row=0)では斜めの三が片側塞がれるため三三禁にならない", () => {
    const board = createEmptyBoard();
    // 横方向の三: ・●●*・ (col=5,6に石, col=7に置く) → 活三
    board[0][5] = "black";
    board[0][6] = "black";
    // 斜め方向（左下↙）: (1,6), (2,5) に石を置いて (0,7) に置く
    // しかし (0,7) の右上方向は盤外なので、斜めの三は片側が塞がれている
    board[1][6] = "black";
    board[2][5] = "black";

    // 横は活三だが、斜めは止め三（盤外で塞がれ）→ 三三禁ではない
    const result = checkForbiddenMove(board, 0, 7);
    expect(result.isForbidden).toBe(false);
  });

  it("盤端近く(row=2)で三三禁が成立", () => {
    const board = createEmptyBoard();
    // 横方向の三: ・●●*・ (col=5,6に石, col=7に置く) → 活三
    board[2][5] = "black";
    board[2][6] = "black";
    // 斜め方向（左下↙）: (3,6), (4,5) に石 → (2,7) に置くと活三
    // 達四点は (1,8) と (5,4)
    board[3][6] = "black";
    board[4][5] = "black";

    // 両方とも活三 → 三三禁
    const result = checkForbiddenMove(board, 2, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("盤端(col=14)では斜めの三が片側塞がれるため三三禁にならない", () => {
    const board = createEmptyBoard();
    // 縦方向の三: ・●●*・ (row=5,6に石, row=7に置く) → 活三
    board[5][14] = "black";
    board[6][14] = "black";
    // 斜め方向（左上↖）: (6,13), (5,12) に石を置いて (7,14) に置く
    // しかし (7,14) の右下方向は盤外なので、斜めの三は片側が塞がれている
    board[6][13] = "black";
    board[5][12] = "black";

    // 縦は活三だが、斜めは止め三（盤外で塞がれ）→ 三三禁ではない
    const result = checkForbiddenMove(board, 7, 14);
    expect(result.isForbidden).toBe(false);
  });

  it("盤端近く(col=12)で三三禁が成立", () => {
    const board = createEmptyBoard();
    // 縦方向の三: ・●●*・ (row=5,6に石, row=7に置く) → 活三
    board[5][12] = "black";
    board[6][12] = "black";
    // 斜め方向（左上↖）: (6,11), (5,10) に石 → (7,12) に置くと活三
    // 達四点は (4,9) と (8,13)
    board[6][11] = "black";
    board[5][10] = "black";

    // 両方とも活三 → 三三禁
    const result = checkForbiddenMove(board, 7, 12);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });

  it("盤端での長連禁", () => {
    const board = createEmptyBoard();
    // row=0 に5連を置いて6連目で長連禁
    board[0][0] = "black";
    board[0][1] = "black";
    board[0][2] = "black";
    board[0][3] = "black";
    board[0][4] = "black";

    const result = checkForbiddenMove(board, 0, 5);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("overline");
  });
});

describe("黒石専用の禁手（白石は禁手なし）", () => {
  // 注意: checkForbiddenMove は黒石専用の関数として実装されている
  // 白石の禁手判定は行わない（連珠のルール上、白石に禁手はない）

  it("checkForbiddenMoveは黒石専用（白石が置かれた位置は判定スキップ）", () => {
    const board = createEmptyBoard();
    // 白石が置かれている位置を判定しようとしても禁手にならない
    board[7][7] = "white";

    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false);
  });

  it("白石があっても黒石の三三禁判定は正常に動作", () => {
    const board = createEmptyBoard();
    // 横方向の三（白石で片側塞がれ）
    board[7][4] = "white"; // 左端を白で塞ぐ
    board[7][5] = "black";
    board[7][6] = "black";
    // col=7 に置く

    // 縦方向の三（両端開き）
    board[5][7] = "black";
    board[6][7] = "black";

    // 横は止め三（白石で塞がれ）、縦は活三 → 三三禁ではない
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false);
  });
});

describe("飛び四の追加パターン", () => {
  it("●・●●● パターン（1石+空き+3連）で四四禁になる", () => {
    const board = createEmptyBoard();
    // 横方向: ●・*●●● (row=7, col=4=石, col=5=空, col=6=置く, cols 7,8,9=石)
    board[7][4] = "black";
    // col=5 は空き（飛びの空き）
    // col=6 が置く位置
    board[7][7] = "black";
    board[7][8] = "black";
    board[7][9] = "black";

    // 縦方向に別の四を作る: ●●●* (col=6, rows 4,5,6=石, row=7=置く)
    board[4][6] = "black";
    board[5][6] = "black";
    board[6][6] = "black";

    // (7,6) に置くと横に飛び四(●・●●●) + 縦に連続四(●●●●) = 四四禁
    const result = checkForbiddenMove(board, 7, 6);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-four");
  });

  it("●・●●● パターンで五連になる場合は禁手ではない", () => {
    const board = createEmptyBoard();
    // 横方向: ●・*●●● (row=7, col=4=石, col=5=空, col=6=置く, cols 7,8,9=石)
    // これは ●・●●●● で6石になるので...実際は ●*●●● で5連
    board[7][4] = "black";
    // col=5 が置く位置
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";

    // col=5 に置くと ●●●●● で五連 → 禁手ではない
    const result = checkForbiddenMove(board, 7, 5);
    expect(result.isForbidden).toBe(false);
  });

  it("●●●・* パターン（置く石が末尾）で四四禁になる", () => {
    // 実際のゲームで発生したバグのリグレッションテスト
    // 縦方向: ●●●・* (col=8, rows 6,7,8=石, row=5=空, row=4=置く)
    // 斜め方向: ●●●・* (6,6), (7,5), (8,4) = 石, (5,7)=空, (4,8)=置く
    const board = createEmptyBoard();

    // 縦方向の石（下から上へ: 8,7,6、空き5、置く4）
    board[8][8] = "black";
    board[7][8] = "black";
    board[6][8] = "black";
    // row=5, col=8 は空き（飛びの空き）
    // row=4, col=8 が置く位置

    // 斜め方向の石（右下から左上へ）
    board[8][4] = "black";
    board[7][5] = "black";
    board[6][6] = "black";
    // (5,7) は空き（飛びの空き）
    // (4,8) が置く位置（縦と共通）

    // (4,8) に置くと縦に飛び四(●●●・●) + 斜めに飛び四(●●●・●) = 四四禁
    const result = checkForbiddenMove(board, 4, 8);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-four");
  });

  it("●●・●* パターン（置く石が末尾）で四四禁になる", () => {
    // パターン2: ●●・●● の末尾に置く場合
    const board = createEmptyBoard();

    // 横方向: ●●・●* (row=7, cols 4,5=石, col=6=空, col=7=石, col=8=置く)
    board[7][4] = "black";
    board[7][5] = "black";
    // col=6 は空き
    board[7][7] = "black";
    // col=8 が置く位置

    // 縦方向に別の四を作る: ●●●* (col=8, rows 4,5,6=石, row=7=置く)
    board[4][8] = "black";
    board[5][8] = "black";
    board[6][8] = "black";

    // (7,8) に置くと横に飛び四(●●・●●) + 縦に連続四(●●●●) = 四四禁
    const result = checkForbiddenMove(board, 7, 8);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-four");
  });
});

describe("四の種類（達四/止四）", () => {
  it("達四（・●●●●・）同士で四四禁", () => {
    const board = createEmptyBoard();
    // 横方向: ・●●●*・ (row=7, cols 5,6,7=石, col=8=置く)
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    // col=8 が置く位置、col=4とcol=9は空き → 達四

    // 縦方向: ・●●●*・ (col=8, rows 5,6,7=石, row=8=置く)
    board[5][8] = "black";
    board[6][8] = "black";
    board[7][8] = "black";

    // これは (7,8) に既に石があるので (8,8) で判定
    // 縦方向を修正
    const board2 = createEmptyBoard();
    board2[7][5] = "black";
    board2[7][6] = "black";
    board2[7][7] = "black";
    // 縦方向
    board2[5][8] = "black";
    board2[6][8] = "black";
    board2[7][8] = "black";

    // (8,8) に置くと縦に達四、でも横には四がない
    // 別のケースを作る

    const board3 = createEmptyBoard();
    // 横方向の四: ●●●* (cols 4,5,6=石, col=7=置く)
    board3[7][4] = "black";
    board3[7][5] = "black";
    board3[7][6] = "black";
    // 縦方向の四: ●●●* (rows 4,5,6=石, row=7=置く)
    board3[4][7] = "black";
    board3[5][7] = "black";
    board3[6][7] = "black";

    const result = checkForbiddenMove(board3, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-four");
  });

  it("止四（白●●●●・）と連続四で四四禁", () => {
    const board = createEmptyBoard();
    // 横方向の止四: 白●●●* (col=3=白, cols 4,5,6=黒, col=7=置く)
    board[7][3] = "white";
    board[7][4] = "black";
    board[7][5] = "black";
    board[7][6] = "black";
    // 縦方向の四: ●●●* (rows 4,5,6=石, row=7=置く)
    board[4][7] = "black";
    board[5][7] = "black";
    board[6][7] = "black";

    // (7,7) に置くと横に止四 + 縦に四 = 四四禁
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-four");
  });
});

describe("引き分けルール", () => {
  describe("DRAW_MOVE_LIMIT（引き分け手数上限）", () => {
    it("引き分け上限は正の整数", () => {
      expect(DRAW_MOVE_LIMIT).toBeGreaterThan(0);
      expect(Number.isInteger(DRAW_MOVE_LIMIT)).toBe(true);
    });
  });

  describe("checkDraw（引き分け判定）", () => {
    it("上限未満では引き分けにならない", () => {
      expect(checkDraw(DRAW_MOVE_LIMIT - 1)).toBe(false);
    });

    it("上限に達したら引き分けになる", () => {
      expect(checkDraw(DRAW_MOVE_LIMIT)).toBe(true);
    });

    it("上限を超えても引き分けになる", () => {
      expect(checkDraw(DRAW_MOVE_LIMIT + 1)).toBe(true);
      expect(checkDraw(DRAW_MOVE_LIMIT + 100)).toBe(true);
    });

    it("0手では引き分けにならない", () => {
      expect(checkDraw(0)).toBe(false);
    });
  });
});

/**
 * 跳びパターン判定の色パラメータリグレッションテスト
 *
 * バグ概要:
 * - checkJumpFour, checkJumpThree が常に "black" で判定していたため、
 *   白番で相手（黒）のパターンを自分のパターンとして誤検出していた
 *
 * 修正日: 2026-02-01
 */
describe("checkJumpFour 色パラメータ", () => {
  it("相手の石を自分の跳び四として誤検出しない", () => {
    const board = createEmptyBoard();
    // 黒の跳び四パターンを作成: ●●・● (横方向)
    board[7][5] = "black";
    board[7][6] = "black";
    // (7,7) は空き
    board[7][8] = "black";

    // 白として判定すると false になるべき（修正前はバグで true になっていた）
    const result = checkJumpFour(board, 7, 7, 2, "white");
    expect(result).toBe(false);
  });

  it("斜め方向でも相手の跳び四を誤検出しない", () => {
    const board = createEmptyBoard();
    // 黒の斜め跳び四: (5,5)-(6,6)-(8,8) で (7,7) が空き
    board[5][5] = "black";
    board[6][6] = "black";
    // (7,7) は空き
    board[8][8] = "black";

    // 方向インデックス 3 = 右下斜め
    const result = checkJumpFour(board, 7, 7, 3, "white");
    expect(result).toBe(false);
  });
});

describe("checkJumpThree 色パラメータ", () => {
  it("相手の石を自分の跳び三として誤検出しない", () => {
    const board = createEmptyBoard();
    // 黒の跳び三パターン: ・●・●●・
    board[7][5] = "black";
    board[7][7] = "black";
    board[7][8] = "black";

    // 白として判定すると false になるべき（修正前はバグで true になっていた）
    const result = checkJumpThree(board, 7, 6, 2, "white");
    expect(result).toBe(false);
  });

  it("斜め方向でも相手の跳び三を誤検出しない（実際のバグ再現）", () => {
    // 実際のバグケース: 白番で (5,5) を評価した際、
    // 黒の斜め跳び三 (7,7)-(8,8) を白のパターンとして誤検出
    const board = createEmptyBoard();
    // 黒の斜めパターン: (7,7), (8,8) に黒石
    board[7][7] = "black";
    board[8][8] = "black";

    // 方向インデックス 3 = 右下斜め
    // (5,5) → (6,6) 空き → (7,7) 黒 → (8,8) 黒
    // 白として検出してはいけない
    const result = checkJumpThree(board, 5, 5, 3, "white");
    expect(result).toBe(false);

    // 同様に (6,6) でも誤検出しない
    const result2 = checkJumpThree(board, 6, 6, 3, "white");
    expect(result2).toBe(false);
  });
});

describe("達四点が長連隣接で止め四になるケース", () => {
  it("シンプル版: 横の達四点が止め四なら三として認定しない", () => {
    const board = createEmptyBoard();
    // row=7: col2,3=黒, col5,6=黒, col7=置く位置
    //   col: 0  1  2  3  4  5  6  7  8  9
    //        ・ ・ ● ● ・ ● ● *  ・ ・
    //
    // 横: col5,6,7 で三 → 達四点は col4 と col8
    //   col8 に置くと 5-6-7-8 の四。end(col4)は空だがその先col3=黒 → 止め四
    //   col4 に置くと 2-3-4-5-6-7 = 6連 → 長連禁
    // → 横方向は有効な三ではない
    board[7][2] = "black";
    board[7][3] = "black";
    board[7][5] = "black";
    board[7][6] = "black";

    // 縦: row5,6=黒, row7=置く → 有効な三
    board[5][7] = "black";
    board[6][7] = "black";

    // 有効な三は縦のみ → 三々禁ではない
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false);
  });

  it("実局面: 棋譜の局面でI4は三々禁ではない", () => {
    const board = createEmptyBoard();
    // 棋譜: H8 G8 I6 G9 G7 I9 F9 H9 H7 F7 I10 F8 K9 G10 H10 E8
    //        F11 E7 E6 D8 C8 D6 C5 F6 C9 D7 D9 G12 G11 D5 D4 F5
    //        F4 G5 H4 H5 E5 J5 I5 G6
    // 座標変換: col = letter(A=0), row = 15 - number

    // 黒石（奇数手）
    board[7][7] = "black"; // H8
    board[9][8] = "black"; // I6
    board[8][6] = "black"; // G7
    board[6][5] = "black"; // F9
    board[8][7] = "black"; // H7
    board[5][8] = "black"; // I10
    board[6][10] = "black"; // K9
    board[5][7] = "black"; // H10
    board[4][5] = "black"; // F11
    board[9][4] = "black"; // E6
    board[7][2] = "black"; // C8
    board[10][2] = "black"; // C5
    board[6][2] = "black"; // C9
    board[6][3] = "black"; // D9
    board[4][6] = "black"; // G11
    board[11][3] = "black"; // D4
    board[11][5] = "black"; // F4
    board[11][7] = "black"; // H4
    board[10][4] = "black"; // E5
    board[10][8] = "black"; // I5

    // 白石（偶数手）
    board[7][6] = "white"; // G8
    board[6][6] = "white"; // G9
    board[6][8] = "white"; // I9
    board[6][7] = "white"; // H9
    board[8][5] = "white"; // F7
    board[7][5] = "white"; // F8
    board[5][6] = "white"; // G10
    board[7][4] = "white"; // E8
    board[8][4] = "white"; // E7
    board[7][3] = "white"; // D8
    board[9][3] = "white"; // D6
    board[9][5] = "white"; // F6
    board[8][3] = "white"; // D7
    board[3][6] = "white"; // G12
    board[10][3] = "white"; // D5
    board[10][5] = "white"; // F5
    board[10][6] = "white"; // G5
    board[10][7] = "white"; // H5
    board[10][9] = "white"; // J5
    board[9][6] = "white"; // G6

    // I4 = col8, row=15-4=11 → (11, 8)
    // 横: F4(11,5)-_-H4(11,7)-I4(11,8) → 飛び三
    //   達四点 G4(11,6): 置くと 5-6-7-8=四, end(col4)空だが先のcol3=D4=黒 → 止め四
    // 縦: I5(10,8)-I4(11,8) + I6(9,8)=黒 → 9,10,11=三
    //   達四点は有効
    // → 有効な三は縦のみ → 三々禁ではない
    const result = checkForbiddenMove(board, 11, 8);
    expect(result.isForbidden).toBe(false);
  });

  it("正常系: 長連隣接のない通常の三々は引き続き禁手", () => {
    const board = createEmptyBoard();
    // 横: col5,6=黒, col7=置く → 達四点 col4, col8（どちらも有効）
    board[7][5] = "black";
    board[7][6] = "black";
    // 縦: row5,6=黒, row7=置く → 達四点 row4, row8（どちらも有効）
    board[5][7] = "black";
    board[6][7] = "black";

    // 通常の三々禁
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(true);
    expect(result.type).toBe("double-three");
  });
});

describe("checkForbiddenMoveWithContext（グローバルキャッシュ活用版）", () => {
  // テスト用のキャッシュヘルパーを作成
  type ForbiddenMoveType = "double-three" | "double-four" | "overline" | null;
  interface TestForbiddenResult {
    isForbidden: boolean;
    type: ForbiddenMoveType;
    positions?: { row: number; col: number }[];
  }

  function createTestCache(): {
    cache: Map<string, TestForbiddenResult>;
    get: (
      hash: bigint,
      row: number,
      col: number,
    ) => TestForbiddenResult | undefined;
    set: (
      hash: bigint,
      row: number,
      col: number,
      result: TestForbiddenResult,
    ) => void;
  } {
    const cache = new Map<string, TestForbiddenResult>();
    return {
      cache,
      get: (
        hash: bigint,
        row: number,
        col: number,
      ): TestForbiddenResult | undefined => {
        const key = `${hash}:${row},${col}`;
        return cache.get(key);
      },
      set: (
        hash: bigint,
        row: number,
        col: number,
        result: TestForbiddenResult,
      ): void => {
        const key = `${hash}:${row},${col}`;
        cache.set(key, result);
      },
    };
  }

  it("checkForbiddenMoveと同じ結果を返す（禁手なし）", () => {
    const board = createEmptyBoard();
    board[7][7] = "black";
    board[7][8] = "black";

    const { get: globalGet, set: globalSet } = createTestCache();

    const result = checkForbiddenMoveWithContext(board, 7, 6, {
      globalGet,
      globalSet,
      boardHash: 12345n,
    });
    const expected = checkForbiddenMove(board, 7, 6);

    expect(result.isForbidden).toBe(expected.isForbidden);
    expect(result.type).toBe(expected.type);
  });

  it("checkForbiddenMoveと同じ結果を返す（三三）", () => {
    const board = createEmptyBoard();
    // 三三パターンを作成
    // ・・○○○・・
    // ・・・●・・・
    // ・・・●・・・
    // ○●●★●●○
    // ・・・●・・・
    // ・・・●・・・
    // ・・○○○・・
    board[5][7] = "black";
    board[6][7] = "black";
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][8] = "black";
    board[7][9] = "black";
    board[8][7] = "black";
    board[9][7] = "black";

    const { get: globalGet, set: globalSet } = createTestCache();

    const result = checkForbiddenMoveWithContext(board, 7, 7, {
      globalGet,
      globalSet,
      boardHash: 12345n,
    });
    const expected = checkForbiddenMove(board, 7, 7);

    expect(result.isForbidden).toBe(expected.isForbidden);
    expect(result.type).toBe(expected.type);
  });

  it("グローバルキャッシュに結果を保存する", () => {
    const board = createEmptyBoard();
    board[7][7] = "black";

    const { get: globalGet, set: globalSet } = createTestCache();

    checkForbiddenMoveWithContext(board, 7, 8, {
      globalGet,
      globalSet,
      boardHash: 12345n,
    });

    // キャッシュに保存されたか確認
    const cached = globalGet(12345n, 7, 8);
    expect(cached).toBeDefined();
    expect(cached?.isForbidden).toBe(false);
  });

  it("グローバルキャッシュからヒットする", () => {
    const board = createEmptyBoard();
    board[7][7] = "black";

    let getCalled = 0;

    const { cache: globalCache } = createTestCache();
    const globalGet = (
      hash: bigint,
      row: number,
      col: number,
    ): TestForbiddenResult | undefined => {
      getCalled++;
      const key = `${hash}:${row},${col}`;
      return globalCache.get(key);
    };
    const globalSet = (
      hash: bigint,
      row: number,
      col: number,
      result: TestForbiddenResult,
    ): void => {
      const key = `${hash}:${row},${col}`;
      globalCache.set(key, result);
    };

    // 1回目の呼び出し
    checkForbiddenMoveWithContext(board, 7, 8, {
      globalGet,
      globalSet,
      boardHash: 12345n,
    });

    expect(getCalled).toBe(1); // 最初のgetで1回

    // 2回目の呼び出し（キャッシュヒット）
    const result = checkForbiddenMoveWithContext(board, 7, 8, {
      globalGet,
      globalSet,
      boardHash: 12345n,
    });

    expect(getCalled).toBe(2); // 2回目のgetで+1
    // キャッシュヒット時はcheckForbiddenMoveWithContext内部では
    // setは呼ばれない（ヒットしたらそのまま返す）
    expect(result.isForbidden).toBe(false);
  });
});

describe("飛び四の一部を三と誤認識しない", () => {
  it("実局面: 棋譜の局面でF9は四三（合法）であり三三禁ではない", () => {
    // 棋譜: H8 I8 G6 I7 I9 G7 H5 J9 K7 H7 F7 I4 I6 H10 E6 I10 G10 I11 F6 H6 C6 D6 E8 D9
    // F9 = col=5, row=15-9=6 → (6, 5)
    // 斜め右(↘): C6(●) ・ E8(●) F9(●) G10(●) → ●・●●● = 飛び四（四であり三ではない）
    // 縦:      ・ F9(●) ・ F7(●) F6(●) → ●・●● = 飛び三（三）
    // 正しくは: 四×1 + 三×1 → 四三(合法)
    const { board } = createBoardFromRecord(
      "H8 I8 G6 I7 I9 G7 H5 J9 K7 H7 F7 I4 I6 H10 E6 I10 G10 I11 F6 H6 C6 D6 E8 D9",
    );

    const result = checkForbiddenMove(board, 6, 5);
    expect(result.isForbidden).toBe(false);
  });

  it("合成テスト: 飛び四(●・●●[*]) + 縦活三 → 四三で合法", () => {
    const board = createEmptyBoard();
    // 横方向: 飛び四 ●・●●* (row=7, col=3=石, col=4=空, col=5=石, col=6=石, col=7=置く)
    board[7][3] = "black";
    // col=4 は空き（飛びの空き）
    board[7][5] = "black";
    board[7][6] = "black";
    // col=7 が置く位置
    // 置いた後: ●・●●● = 飛び四

    // 縦方向: 活三 ・●●*・ (col=7, rows 5,6=石, row=7=置く)
    board[5][7] = "black";
    board[6][7] = "black";

    // 横は飛び四（四であり三ではない）、縦は活三 → 四三(合法)
    const result = checkForbiddenMove(board, 7, 7);
    expect(result.isForbidden).toBe(false);
  });
});
