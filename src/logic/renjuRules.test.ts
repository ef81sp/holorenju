import { describe, expect, it } from "vitest";

import {
  checkDraw,
  checkFive,
  isFiveLength,
  checkWin,
  copyBoard,
  createEmptyBoard,
  DRAW_MOVE_LIMIT,
  isValidPosition,
} from "./renjuRules";

// #43 PR-6: 図形/禁手判定（checkForbiddenMove/checkJumpFour/checkJumpThree/recognizePattern/
// checkForbiddenMoveWithContext）の TS 実装は物理削除し Zig/WASM 単一ソースへ一本化。
// それらのテストは zig native test（test_forbidden / test_patterns / test_jump_patterns）が担保する。
// 本ファイルには core（Zig 化対象外のルール基盤）のテストのみを残す。

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

describe("isFiveLength（五の定義）", () => {
  it("黒はちょうど5のみ五", () => {
    expect(isFiveLength(4, "black")).toBe(false);
    expect(isFiveLength(5, "black")).toBe(true);
    expect(isFiveLength(6, "black")).toBe(false);
  });

  it("白は5以上が五（長連も勝ち）", () => {
    expect(isFiveLength(4, "white")).toBe(false);
    expect(isFiveLength(5, "white")).toBe(true);
    expect(isFiveLength(6, "white")).toBe(true);
  });

  it("空点（null）は型で弾かれる（実行時に渡っても白扱いしない）", () => {
    // `PlayerColor` に絞っているので TS 上は渡せない。JS 境界から渡ってきた場合の
    // 安全側の挙動（黒と同じ === 5）を固定する。
    const asAny = isFiveLength as (l: number, c: unknown) => boolean;
    expect(asAny(6, null)).toBe(false);
    expect(asAny(7, null)).toBe(false);
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

  it("黒の六連（長連）の場合はfalseを返す", () => {
    const board = createEmptyBoard();
    board[7][4] = "black";
    board[7][5] = "black";
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";
    board[7][9] = "black";

    // 黒は長連（6連以上）なので、ちょうど5連ではない
    expect(checkFive(board, 7, 9, "black")).toBe(false);
  });

  // #125: 白に長連禁手はないので、白の 6 連以上は五（＝勝ち）
  it("白の六連（長連）はtrueを返す", () => {
    const board = createEmptyBoard();
    for (let col = 4; col <= 9; col++) {
      board[7][col] = "white";
    }

    expect(checkFive(board, 7, 9, "white")).toBe(true);
  });

  it("#125 の実測例: 白 _WWWW_W のギャップを埋めると五（7連）", () => {
    const board = createEmptyBoard();
    // col2..5 白, col6 空, col7 白
    for (const col of [2, 3, 4, 5, 7]) {
      board[7][col] = "white";
    }

    board[7][6] = "white";
    expect(checkFive(board, 7, 6, "white")).toBe(true);
  });

  it("同形でも黒は長連なのでfalse（黒白で基準が異なる）", () => {
    const board = createEmptyBoard();
    for (const col of [2, 3, 4, 5, 7]) {
      board[7][col] = "black";
    }

    board[7][6] = "black";
    expect(checkFive(board, 7, 6, "black")).toBe(false);
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

  // #125: 白の長連は勝ち
  it("白の六連は勝ちと判定する", () => {
    const board = createEmptyBoard();
    for (let col = 4; col <= 9; col++) {
      board[7][col] = "white";
    }

    expect(checkWin(board, { row: 7, col: 9 }, "white")).toBe(true);
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
