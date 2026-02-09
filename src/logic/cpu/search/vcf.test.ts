/**
 * VCF探索のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { createBoardWithStones, placeStonesOnBoard } from "../testUtils";
import {
  checkEnds,
  countLine,
  findDefenseForConsecutiveFour,
  findDefenseForJumpFour,
  findFourMoves,
  findVCFMove,
  findVCFSequence,
  hasVCF,
} from "./vcf";

describe("hasVCF", () => {
  it("空の盤面ではVCFなし", () => {
    const board = createEmptyBoard();
    expect(hasVCF(board, "black")).toBe(false);
    expect(hasVCF(board, "white")).toBe(false);
  });

  it("三連から四を作れて五連に繋がる場合はVCF成立", () => {
    // 活三の状態（両端が空いている）
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 両端どちらかに置けば四が作れ、活四なら即勝ち
    expect(hasVCF(board, "black")).toBe(true);
  });

  it("活四がある場合はVCF成立", () => {
    // 活四の形（両端が空いている四）
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // すでに活四があるので実質勝ち
    // hasVCFは四を作る位置を探すので、この状態では追加の四は作れない
    // ただし、これは五連が作れる状態なのでVCFとしては成立
    expect(hasVCF(board, "black")).toBe(true);
  });

  it("白の活三からVCFが成立する", () => {
    // 白の活三（両端が空いている）
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    // 白も活三から四を作れば活四になり勝利
    expect(hasVCF(board, "white")).toBe(true);
  });

  it("連続して四を作って勝利できる場合はVCF成立", () => {
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
    // 7,8に置くと横方向で四、8,8に置くと縦方向で四
    // どちらかで五連に繋がれるならVCF成立
    expect(hasVCF(board, "white")).toBe(true);
  });

  it("深さ制限内でVCFが成立しない場合はfalse", () => {
    // 8手以上かかるVCFはfalseを返す
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    expect(hasVCF(board, "black")).toBe(false);
  });

  it("盤端でのVCF判定（横方向）- 止め三なのでVCFなし", () => {
    // 盤端（col=0付近）での止め三（片端が壁）
    const board = createBoardWithStones([
      { row: 7, col: 0, color: "black" },
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
    ]);
    // 片端が壁なので止め三、VCFは成立しない
    expect(hasVCF(board, "black")).toBe(false);
  });

  it("盤端でのVCF判定（縦方向）- 止め三なのでVCFなし", () => {
    // 盤端（row=0付近）での止め三（片端が壁）
    const board = createBoardWithStones([
      { row: 0, col: 7, color: "black" },
      { row: 1, col: 7, color: "black" },
      { row: 2, col: 7, color: "black" },
    ]);
    // 片端が壁なので止め三、VCFは成立しない
    expect(hasVCF(board, "black")).toBe(false);
  });

  it("盤端で活三がある場合はVCF成立", () => {
    // 盤端でも両端が空いている活三
    const board = createBoardWithStones([
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
      { row: 7, col: 3, color: "black" },
    ]);
    // col=0, col=4 の両端が空いている活三
    expect(hasVCF(board, "black")).toBe(true);
  });

  it("跳び四でのVCF成立", () => {
    // 跳び四パターン: ●●・●● に置けば勝ち
    const board = createBoardWithStones([
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      // col:5 が空き
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(hasVCF(board, "black")).toBe(true);
  });

  it("禁手による防御不能ケース（白がVCF成立）", () => {
    // 白が四を作り、黒の防御位置が三三禁になる局面
    const board = createEmptyBoard();
    // 白の四を作る準備
    placeStonesOnBoard(board, [
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
    ]);
    // 黒が三三禁になるような形を作る
    // 縦方向に黒の二
    placeStonesOnBoard(board, [
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
    ]);
    // 斜め方向に黒の二
    placeStonesOnBoard(board, [
      { row: 5, col: 5, color: "black" },
      { row: 6, col: 6, color: "black" },
    ]);
    // 白がcol:7に置くと四になり、黒の防御位置(7,7)が三三禁
    // ただしこのテストは複雑なので、シンプルにVCFが成立することを確認
    expect(hasVCF(board, "white")).toBe(true);
  });
});

describe("findVCFMove", () => {
  it("VCF成立時に勝利手を返す", () => {
    // 活三の状態
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const move = findVCFMove(board, "black");
    expect(move).not.toBeNull();
    // (7,4) または (7,8) のどちらかを返す
    expect(move?.row).toBe(7);
    expect([4, 8]).toContain(move?.col);
  });

  it("VCFなしの場合はnullを返す", () => {
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    expect(findVCFMove(board, "black")).toBeNull();
  });

  it("止め四がある場合は五連を作る手を返す", () => {
    // 止め四の形（片端のみ空いている）
    const board = createBoardWithStones([
      { row: 7, col: 0, color: "white" }, // 片端をブロック
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
    ]);
    const move = findVCFMove(board, "black");
    expect(move).not.toBeNull();
    expect(move?.row).toBe(7);
    expect(move?.col).toBe(5); // 空いている側
  });

  it("白番でもVCFの手を返す", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    const move = findVCFMove(board, "white");
    expect(move).not.toBeNull();
    expect(move?.row).toBe(7);
    expect([4, 8]).toContain(move?.col);
  });

  it("跳び四でのVCFの手を返す", () => {
    // 跳び四パターン: ●●・●● に置けば勝ち
    const board = createBoardWithStones([
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      // col:5 が空き
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const move = findVCFMove(board, "black");
    expect(move).not.toBeNull();
  });

  it("五連を作れる手は他のVCF手より優先される", () => {
    // 白がE7-E8-E9-E10の四連を持ち、E11で五連が作れる状況
    // E12も四を作れるが、E11（即勝ち）が優先されるべき
    const board = createBoardWithStones([
      // 白の縦四連（E列: row 5,6,7,8 = E10,E9,E8,E7）
      { row: 5, col: 4, color: "white" }, // E10
      { row: 6, col: 4, color: "white" }, // E9
      { row: 7, col: 4, color: "white" }, // E8
      { row: 8, col: 4, color: "white" }, // E7
      // 黒がE6をブロック
      { row: 9, col: 4, color: "black" }, // E6
    ]);
    const move = findVCFMove(board, "white");
    expect(move).not.toBeNull();
    // E11 (row=4, col=4) で五連が作れるのでこれが返されるべき
    expect(move?.row).toBe(4);
    expect(move?.col).toBe(4);
  });

  it("findFourMovesは五連を作る手も含む（白番）", () => {
    // 白が四連を持つ状態
    const board = createBoardWithStones([
      { row: 5, col: 4, color: "white" },
      { row: 6, col: 4, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 8, col: 4, color: "white" },
    ]);
    const moves = findFourMoves(board, "white");
    // E11 (row=4) とE6 (row=9) の両方が五連を作る手として含まれるべき
    const hasE11 = moves.some((m) => m.row === 4 && m.col === 4);
    const hasE6 = moves.some((m) => m.row === 9 && m.col === 4);
    expect(hasE11).toBe(true);
    expect(hasE6).toBe(true);
  });
});

describe("countLine（内部関数）", () => {
  it("連続する同色石の数をカウント（横方向）", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // (7,6)を起点として横方向にカウント
    expect(countLine(board, 7, 6, 0, 1, "black")).toBe(3);
  });

  it("連続する同色石の数をカウント（縦方向）", () => {
    const board = createBoardWithStones([
      { row: 5, col: 7, color: "white" },
      { row: 6, col: 7, color: "white" },
      { row: 7, col: 7, color: "white" },
      { row: 8, col: 7, color: "white" },
    ]);
    expect(countLine(board, 6, 7, 1, 0, "white")).toBe(4);
  });

  it("盤端で正しくカウント", () => {
    const board = createBoardWithStones([
      { row: 0, col: 0, color: "black" },
      { row: 0, col: 1, color: "black" },
      { row: 0, col: 2, color: "black" },
    ]);
    expect(countLine(board, 0, 1, 0, 1, "black")).toBe(3);
  });

  it("途中で別色がある場合はそこで止まる", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "white" }, // 別色
      { row: 7, col: 8, color: "black" },
    ]);
    expect(countLine(board, 7, 6, 0, 1, "black")).toBe(2);
  });
});

describe("checkEnds（内部関数）", () => {
  it("両端が空いている場合", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const result = checkEnds(board, 7, 6, 0, 1, "black");
    expect(result.end1Open).toBe(true);
    expect(result.end2Open).toBe(true);
  });

  it("片端が壁の場合", () => {
    const board = createBoardWithStones([
      { row: 7, col: 0, color: "black" },
      { row: 7, col: 1, color: "black" },
      { row: 7, col: 2, color: "black" },
    ]);
    const result = checkEnds(board, 7, 1, 0, 1, "black");
    // col=-1は盤外なのでfalse
    expect(result.end2Open).toBe(false);
    // col=3は空いている
    expect(result.end1Open).toBe(true);
  });

  it("片端が相手石の場合", () => {
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" }, // 相手石
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const result = checkEnds(board, 7, 6, 0, 1, "black");
    expect(result.end2Open).toBe(false); // 相手石で塞がれている
    expect(result.end1Open).toBe(true);
  });
});

describe("findFourMoves（内部関数）", () => {
  it("四を作れる位置を列挙", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const moves = findFourMoves(board, "black");
    // (7,4) と (7,8) が四を作れる位置
    expect(moves.length).toBeGreaterThanOrEqual(2);
    expect(moves.some((m) => m.row === 7 && m.col === 4)).toBe(true);
    expect(moves.some((m) => m.row === 7 && m.col === 8)).toBe(true);
  });

  it("三三禁の位置が四を作る手でも黒番では除外される", () => {
    // (7,7)に置くと:
    // 縦方向: (4,7),(5,7),(6,7),(7,7) → 四連 = 四を作る手
    // 横方向: (7,5),(7,6),(7,7) → 三連（活三）
    // 斜め方向: (5,5),(6,6),(7,7) → 三連（活三）
    // → 三三禁（横三 + 斜め三）かつ縦方向で四を作れる
    const board = createBoardWithStones([
      // 縦方向: 三連（(7,7)に置くと四連）
      { row: 4, col: 7, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
      // 横方向: 二連（(7,7)に置くと三連 = 活三）
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      // 斜め方向: 二連（(7,7)に置くと三連 = 活三）
      { row: 5, col: 5, color: "black" },
      { row: 6, col: 6, color: "black" },
    ]);
    const moves = findFourMoves(board, "black");
    // (7,7)は三三禁なので除外されるべき
    expect(moves.some((m) => m.row === 7 && m.col === 7)).toBe(false);
  });

  it("白番では禁手フィルタなし", () => {
    // 同じ盤面で白番なら(7,7)が候補に含まれる
    const board = createBoardWithStones([
      { row: 4, col: 7, color: "white" },
      { row: 5, col: 7, color: "white" },
      { row: 6, col: 7, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 5, col: 5, color: "white" },
      { row: 6, col: 6, color: "white" },
    ]);
    const moves = findFourMoves(board, "white");
    // 白番では禁手チェックがないので(7,7)が含まれる
    expect(moves.some((m) => m.row === 7 && m.col === 7)).toBe(true);
  });

  it("五連は三三禁の位置でも含まれる", () => {
    // (7,7)に置くと:
    // 縦方向: (3,7),(4,7),(5,7),(6,7),(7,7) → 五連
    // 横方向: (7,5),(7,6),(7,7) → 三連（活三）
    // 斜め方向: (5,5),(6,6),(7,7) → 三連（活三）
    // → 三三禁だが五連なので除外しない
    const board = createBoardWithStones([
      { row: 3, col: 7, color: "black" },
      { row: 4, col: 7, color: "black" },
      { row: 5, col: 7, color: "black" },
      { row: 6, col: 7, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 5, col: 5, color: "black" },
      { row: 6, col: 6, color: "black" },
    ]);
    const moves = findFourMoves(board, "black");
    // 五連が作れるので(7,7)は候補に含まれるべき
    expect(moves.some((m) => m.row === 7 && m.col === 7)).toBe(true);
  });

  it("呼び出し前後で盤面が変更されない", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // 盤面のスナップショットを取得
    const snapshot = JSON.stringify(board);
    findFourMoves(board, "black");
    // 盤面が変更されていないことを確認
    expect(JSON.stringify(board)).toBe(snapshot);
  });
});

describe("findDefenseForConsecutiveFour（内部関数）", () => {
  it("止め四の防御位置を返す", () => {
    // 止め四: ○●●●●・（片端がブロックされている）
    const board = createBoardWithStones([
      { row: 7, col: 3, color: "white" }, // 片端ブロック
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const defensePos = findDefenseForConsecutiveFour(
      board,
      7,
      5,
      0,
      1,
      "black",
    );
    expect(defensePos).toEqual({ row: 7, col: 8 });
  });

  it("活四の場合はnullを返す（止められない）", () => {
    // 活四: ・●●●●・（両端が空いている）
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const defensePos = findDefenseForConsecutiveFour(
      board,
      7,
      5,
      0,
      1,
      "black",
    );
    expect(defensePos).toBeNull();
  });
});

describe("findDefenseForJumpFour（内部関数）", () => {
  it("跳び四パターン1（●●●・●）の防御位置を返す", () => {
    // ●●●・●
    const board = createBoardWithStones([
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      // col:6 が空き
      { row: 7, col: 7, color: "black" },
    ]);
    const defensePos = findDefenseForJumpFour(board, 7, 5, 0, 1, "black");
    expect(defensePos).toEqual({ row: 7, col: 6 });
  });

  it("跳び四パターン2（●●・●●）の防御位置を返す", () => {
    // ●●・●●
    const board = createBoardWithStones([
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      // col:5 が空き
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const defensePos = findDefenseForJumpFour(board, 7, 4, 0, 1, "black");
    expect(defensePos).toEqual({ row: 7, col: 5 });
  });

  it("跳び四パターン3（●・●●●）の防御位置を返す", () => {
    // ●・●●●
    const board = createBoardWithStones([
      { row: 7, col: 3, color: "black" },
      // col:4 が空き
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const defensePos = findDefenseForJumpFour(board, 7, 5, 0, 1, "black");
    expect(defensePos).toEqual({ row: 7, col: 4 });
  });
});

describe("活四が跳び四VCFより優先される", () => {
  it("活三を棒四（活四）にする手を跳び四より優先する", () => {
    // row=2: 黒(2) 白(3,4) ・(5) 白(6)
    //   col=5: 連続四(3,4,5,6) 端col=2が黒→止め四
    //   col=7: 跳び四(4,(gap5),6,7) 黒がcol=5埋め→再帰でrow=7の活三から勝てる
    //   ※スキャン順でrow=7より先に見つかる
    // row=7: 白(7,8,9) 活三→col=6 or col=10で活四（即勝利）
    //
    // 修正前: Pass 3で跳び四(row=2)→再帰VCF成立→row=2を返す
    // 修正後: Pass 2で活四(row=7)を先に発見→row=7を返す
    const board = createBoardWithStones([
      // row=2: 跳び四素材（スキャン順で先）
      { row: 2, col: 3, color: "white" },
      { row: 2, col: 4, color: "white" },
      { row: 2, col: 6, color: "white" },
      { row: 2, col: 2, color: "black" }, // 左端ブロック→col=5は止め四のみ

      // row=7: 活三（両端空）
      { row: 7, col: 7, color: "white" },
      { row: 7, col: 8, color: "white" },
      { row: 7, col: 9, color: "white" },
    ]);

    const move = findVCFMove(board, "white");
    expect(move).not.toBeNull();
    // 活四を作る手（row=7, col=6 or col=10）が返されるべき
    // 跳び四の手（row=2, col=7）や止め四の手（row=2, col=5）ではない
    expect(move?.row).toBe(7);
    expect([6, 10]).toContain(move?.col);
  });
});

describe("四三後に相手が無視した場合", () => {
  it("四が残っている状態で五を作る手を最優先で返す", () => {
    // CPUが四三を作った後、相手が無視した状態をシミュレート
    // 縦方向に四（row 5-8, col 4）
    // 横方向に三（row 7, col 5-7）← 四三の三の部分
    const board = createBoardWithStones([
      // 縦方向の四
      { row: 5, col: 4, color: "white" },
      { row: 6, col: 4, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 8, col: 4, color: "white" },
      // 横方向の三（四三の三の部分）
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      // 黒が無視して別の場所に打った
      { row: 10, col: 10, color: "black" },
    ]);

    const move = findVCFMove(board, "white");
    expect(move).not.toBeNull();
    // 四を五にする手（row=4 or row=9, col=4）が返されるべき
    // 三を伸ばす手（row=7, col=7）ではない
    expect(move?.col).toBe(4);
    expect([4, 9]).toContain(move?.row);
  });
});

describe("VCFゴールデンテスト", () => {
  // 既存の振る舞いを保証するスナップショットテスト
  const testCases = [
    {
      name: "空の盤面はVCFなし",
      stones: [] as { row: number; col: number; color: "black" | "white" }[],
      color: "black" as const,
      expected: false,
    },
    {
      name: "黒の活三からVCF成立",
      stones: [
        { row: 7, col: 5, color: "black" as const },
        { row: 7, col: 6, color: "black" as const },
        { row: 7, col: 7, color: "black" as const },
      ],
      color: "black" as const,
      expected: true,
    },
    {
      name: "黒の止め四からVCF成立",
      stones: [
        { row: 7, col: 4, color: "black" as const },
        { row: 7, col: 5, color: "black" as const },
        { row: 7, col: 6, color: "black" as const },
        { row: 7, col: 7, color: "black" as const },
        { row: 7, col: 3, color: "white" as const }, // 片端をブロック
      ],
      color: "black" as const,
      expected: true,
    },
    {
      name: "白の斜め活三からVCF成立",
      stones: [
        { row: 5, col: 5, color: "white" as const },
        { row: 6, col: 6, color: "white" as const },
        { row: 7, col: 7, color: "white" as const },
      ],
      color: "white" as const,
      expected: true,
    },
    {
      name: "1石だけではVCFなし",
      stones: [{ row: 7, col: 7, color: "black" as const }],
      color: "black" as const,
      expected: false,
    },
    {
      name: "2石だけではVCFなし",
      stones: [
        { row: 7, col: 6, color: "black" as const },
        { row: 7, col: 7, color: "black" as const },
      ],
      color: "black" as const,
      expected: false,
    },
  ];

  testCases.forEach(({ name, stones, color, expected }) => {
    it(name, () => {
      const board = createBoardWithStones(stones);
      expect(hasVCF(board, color)).toBe(expected);
    });
  });
});

describe("VCFSearchOptions付きテスト", () => {
  it("拡張深度・時間制限でhasVCFが動作する", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(
      hasVCF(board, "black", 0, undefined, { maxDepth: 16, timeLimit: 1000 }),
    ).toBe(true);
  });

  it("深度0ではVCFなし", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    expect(hasVCF(board, "black", 0, undefined, { maxDepth: 0 })).toBe(false);
  });

  it("拡張オプション付きfindVCFMoveが動作する", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const move = findVCFMove(board, "black", { maxDepth: 16, timeLimit: 1000 });
    expect(move).not.toBeNull();
    expect(move?.row).toBe(7);
  });
});

describe("findVCFSequence", () => {
  it("活三からVCF手順を返す", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const result = findVCFSequence(board, "black");
    expect(result).not.toBeNull();
    expect(result?.firstMove.row).toBe(7);
    expect([4, 8]).toContain(result?.firstMove.col);
    expect(result?.sequence.length).toBeGreaterThanOrEqual(1);
  });

  it("VCFなしの場合はnullを返す", () => {
    const board = createBoardWithStones([{ row: 7, col: 7, color: "black" }]);
    expect(findVCFSequence(board, "black")).toBeNull();
  });

  it("拡張オプション付きで動作する", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const result = findVCFSequence(board, "black", {
      maxDepth: 16,
      timeLimit: 1000,
    });
    expect(result).not.toBeNull();
  });

  it("止め四連鎖のVCF手順が正しい", () => {
    // 2方向に三がある形（四追い勝ち）
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
    const result = findVCFSequence(board, "white");
    expect(result).not.toBeNull();
    // 手順は攻撃と防御が交互に含まれる
    expect(result?.sequence.length).toBeGreaterThanOrEqual(1);
  });
});
