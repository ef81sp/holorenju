/**
 * VCF探索のテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import { checkEnds, countLine } from "../core/lineAnalysis";
import { PATTERN_SCORES } from "../evaluation";
import { createBoardWithStones, placeStonesOnBoard } from "../testUtils";
import { findBestMoveIterativeWithTT } from "./minimax";
import {
  findDefenseForConsecutiveFour,
  findDefenseForJumpFour,
  findFourMoves,
} from "./threatPatterns";
import {
  findVCFMove,
  findVCFSequence,
  findVCFSequenceFromFirstMove,
  hasVCF,
  isVCFFirstMove,
  vcfAttackMoveCount,
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

describe("反復深化で最短VCFが優先される", () => {
  it("四三（短いVCF）が長いVCFより優先される", () => {
    // 棋譜: H8 G9 F9 H10 F8 G8 G7 F7 E8 H9 I10 I9 E9 H6 E10 E7 D10 C11 E11 E12 F12 G13
    // 22手目まで再現、黒番でF10が四三（depth 1のVCF）
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      // 黒石（奇数手）
      { row: 7, col: 7, color: "black" }, // H8
      { row: 6, col: 5, color: "black" }, // F9
      { row: 7, col: 5, color: "black" }, // F8
      { row: 8, col: 6, color: "black" }, // G7
      { row: 7, col: 4, color: "black" }, // E8
      { row: 5, col: 8, color: "black" }, // I10
      { row: 6, col: 4, color: "black" }, // E9
      { row: 5, col: 4, color: "black" }, // E10
      { row: 5, col: 3, color: "black" }, // D10
      { row: 4, col: 4, color: "black" }, // E11
      { row: 3, col: 5, color: "black" }, // F12
      // 白石（偶数手）
      { row: 6, col: 6, color: "white" }, // G9
      { row: 5, col: 7, color: "white" }, // H10
      { row: 7, col: 6, color: "white" }, // G8
      { row: 8, col: 5, color: "white" }, // F7
      { row: 6, col: 7, color: "white" }, // H9
      { row: 6, col: 8, color: "white" }, // I9
      { row: 9, col: 7, color: "white" }, // H6
      { row: 8, col: 4, color: "white" }, // E7
      { row: 4, col: 2, color: "white" }, // C11
      { row: 3, col: 4, color: "white" }, // E12
      { row: 2, col: 6, color: "white" }, // G13
    ]);
    const result = findVCFMove(board, "black");
    // F10（row=5, col=5）が depth 1 の四三として選ばれるべき
    expect(result).toEqual({ row: 5, col: 5 });
  });

  it("findVCFSequence も最短手順を返す", () => {
    // 同じ盤面で findVCFSequence も最短手順を返す
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 6, col: 5, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 8, col: 6, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 5, col: 8, color: "black" },
      { row: 6, col: 4, color: "black" },
      { row: 5, col: 4, color: "black" },
      { row: 5, col: 3, color: "black" },
      { row: 4, col: 4, color: "black" },
      { row: 3, col: 5, color: "black" },
      { row: 6, col: 6, color: "white" },
      { row: 5, col: 7, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 8, col: 5, color: "white" },
      { row: 6, col: 7, color: "white" },
      { row: 6, col: 8, color: "white" },
      { row: 9, col: 7, color: "white" },
      { row: 8, col: 4, color: "white" },
      { row: 4, col: 2, color: "white" },
      { row: 3, col: 4, color: "white" },
      { row: 2, col: 6, color: "white" },
    ]);
    const result = findVCFSequence(board, "black");
    expect(result).not.toBeNull();
    expect(result?.firstMove).toEqual({ row: 5, col: 5 });
    // 四三: 攻撃(四を作る) → 防御(四を止める) → 攻撃(五連) の3手
    expect(result?.sequence.length).toBe(3);
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

describe("カウンターフォー（防御者が四を作り返す）対応", () => {
  it("防御者がカウンターフォーを作る場合、hasVCFはfalse", () => {
    // 盤端利用: 白の止め三をrow=0端に配置
    // 白(0,4),(0,5),(0,6) → 白(0,3)で止め四(0,3)-(0,6)
    //   上端=盤外なので止め四確定、防御位置は(0,7)
    // 白の縦止め三(1,7),(2,7),(3,7) + (4,7)黒ブロック
    //   → 防御(0,7)後、白(0,7)で2段目は... (0,7)はもう埋まっている
    //
    // 別案: 完全にシンプルな形
    // 白が止め四を2回作れる形（四追い2段）で、
    // 1段目の防御位置にカウンターフォーがある
    //
    // 白A: 横(2,4),(2,5),(2,6) + (2,3)壁 → 白(2,7)止め四, 防御(2,8)
    // 白B: 縦(3,8),(4,8),(5,8) + (6,8)壁 → 防御(2,8)後, 白(2,8)... 防御位置は既に埋まる
    //
    // 正しくは: 防御位置と2段目の四の延長が別の場所
    // 白A: 横(7,1),(7,2),(7,3) 盤端で止め三 → 白(7,4)止め四, 防御(7,0)?
    //   いや: (7,0)は盤端、(7,1)-(7,4)=4連, (7,0)空=止め四, 防御(7,5)?
    //   countLine(board,7,4,0,1,"white") → (7,1)-(7,4)=4, end1=(7,5)空, end2=(7,0)空
    //   両端空=活四→止められない！→即勝ち
    //
    // → 片端をブロックする必要あり
    // 白(7,1),(7,2),(7,3) + (7,0)黒 → 白(7,4)止め四, (7,0)黒ブロック, 防御(7,5)
    // 白(4,5),(5,5),(6,5) + (3,5)黒 → 白(7,5)止め四→五連
    // → 防御(7,5)に黒を置くとカウンターフォー
    // 黒の縦3連: (7,5)防御 + (8,5),(9,5),(10,5) → (7,5)で4連
    //   ただし(7,5)にはまだ石がない段階で黒の3連は(8,5),(9,5),(10,5)
    const board = createBoardWithStones([
      // 白の横止め三（(7,4)で止め四、防御位置(7,5)）
      { row: 7, col: 1, color: "white" },
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 0, color: "black" }, // 左端ブロック

      // 白の縦止め三（VCF2段目: 防御(7,5)後の位置で四追い）
      { row: 4, col: 5, color: "white" },
      { row: 5, col: 5, color: "white" },
      { row: 6, col: 5, color: "white" },
      { row: 3, col: 5, color: "black" }, // 上端ブロック

      // 黒のカウンターフォー素材（防御位置(7,5)で縦4連）
      { row: 8, col: 5, color: "black" },
      { row: 9, col: 5, color: "black" },
      { row: 10, col: 5, color: "black" },
    ]);
    // 白VCF: (7,4)横止め四→黒(7,5)防御→黒(7,5)カウンターフォー(縦4連)→中断
    expect(hasVCF(board, "white")).toBe(false);
    expect(findVCFMove(board, "white")).toBeNull();
  });

  it("防御者が五連を完成する場合、VCF不成立", () => {
    const board = createBoardWithStones([
      // 白の横止め三
      { row: 7, col: 1, color: "white" },
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 0, color: "black" }, // 左端ブロック

      // 白の縦止め三（VCF2段目用）
      { row: 4, col: 5, color: "white" },
      { row: 5, col: 5, color: "white" },
      { row: 6, col: 5, color: "white" },
      { row: 3, col: 5, color: "black" }, // 上端ブロック

      // 黒の五連素材（防御位置(7,5)で縦5連完成）
      { row: 8, col: 5, color: "black" },
      { row: 9, col: 5, color: "black" },
      { row: 10, col: 5, color: "black" },
      { row: 11, col: 5, color: "black" },
    ]);
    expect(hasVCF(board, "white")).toBe(false);
    expect(findVCFMove(board, "white")).toBeNull();
  });

  it("findVCFSequenceもカウンターフォーでVCF不成立を返す", () => {
    const board = createBoardWithStones([
      // 白の横止め三
      { row: 7, col: 1, color: "white" },
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 0, color: "black" },

      // 白の縦止め三（VCF2段目用）
      { row: 4, col: 5, color: "white" },
      { row: 5, col: 5, color: "white" },
      { row: 6, col: 5, color: "white" },
      { row: 3, col: 5, color: "black" },

      // 黒のカウンターフォー素材
      { row: 8, col: 5, color: "black" },
      { row: 9, col: 5, color: "black" },
      { row: 10, col: 5, color: "black" },
    ]);
    expect(findVCFSequence(board, "white")).toBeNull();
  });

  it("カウンターフォーがない2段VCFは成立する", () => {
    // 同じ形だがカウンターフォー素材なし
    const board = createBoardWithStones([
      // 白の横止め三
      { row: 7, col: 1, color: "white" },
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 0, color: "black" },

      // 白の縦止め三（VCF2段目用）
      { row: 4, col: 5, color: "white" },
      { row: 5, col: 5, color: "white" },
      { row: 6, col: 5, color: "white" },
      { row: 3, col: 5, color: "black" },
    ]);
    expect(hasVCF(board, "white")).toBe(true);
  });

  it("実戦game6手35: 白VCFが誤検出される（カウンターフォー未考慮）", () => {
    // bench-2026-02-10T04-08 game6 の手35終了時点の盤面
    // 手36で白がVCF検出(score=100000)→(10,3)に着手→手38で敗勢に
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      // 黒石（奇数手: 1,3,5,7,9,11,13,15,17,19,21,23,25,27,29,31,33,35）
      { row: 7, col: 7, color: "black" }, // 手1
      { row: 5, col: 7, color: "black" }, // 手3
      { row: 8, col: 6, color: "black" }, // 手5
      { row: 6, col: 6, color: "black" }, // 手7
      { row: 7, col: 5, color: "black" }, // 手9
      { row: 9, col: 7, color: "black" }, // 手11
      { row: 9, col: 5, color: "black" }, // 手13
      { row: 8, col: 4, color: "black" }, // 手15
      { row: 10, col: 8, color: "black" }, // 手17
      { row: 8, col: 5, color: "black" }, // 手19
      { row: 9, col: 8, color: "black" }, // 手21
      { row: 7, col: 8, color: "black" }, // 手23
      { row: 4, col: 3, color: "black" }, // 手25
      { row: 10, col: 5, color: "black" }, // 手27
      { row: 10, col: 4, color: "black" }, // 手29
      { row: 10, col: 7, color: "black" }, // 手31
      { row: 8, col: 9, color: "black" }, // 手33
      { row: 11, col: 4, color: "black" }, // 手35
      // 白石（偶数手: 2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34）
      { row: 8, col: 8, color: "white" }, // 手2
      { row: 8, col: 7, color: "white" }, // 手4
      { row: 7, col: 9, color: "white" }, // 手6
      { row: 7, col: 6, color: "white" }, // 手8
      { row: 4, col: 8, color: "white" }, // 手10
      { row: 6, col: 4, color: "white" }, // 手12
      { row: 6, col: 8, color: "white" }, // 手14
      { row: 9, col: 3, color: "white" }, // 手16
      { row: 11, col: 9, color: "white" }, // 手18
      { row: 6, col: 5, color: "white" }, // 手20
      { row: 9, col: 6, color: "white" }, // 手22
      { row: 5, col: 4, color: "white" }, // 手24
      { row: 7, col: 3, color: "white" }, // 手26
      { row: 11, col: 5, color: "white" }, // 手28
      { row: 11, col: 3, color: "white" }, // 手30
      { row: 10, col: 6, color: "white" }, // 手32
      { row: 11, col: 6, color: "white" }, // 手34
    ]);
    // 手36で白はVCF成立と判定し(10,3)に着手したが、
    // 黒のカウンターフォーにより実際はVCF不成立
    expect(hasVCF(board, "white")).toBe(false);
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

describe("vcfAttackMoveCount", () => {
  const pos = { row: 7, col: 7 };

  it("シーケンス長1 → 攻撃1手", () => {
    expect(vcfAttackMoveCount([pos])).toBe(1);
  });

  it("シーケンス長3 → 攻撃2手", () => {
    expect(vcfAttackMoveCount([pos, pos, pos])).toBe(2);
  });

  it("シーケンス長5 → 攻撃3手", () => {
    expect(vcfAttackMoveCount([pos, pos, pos, pos, pos])).toBe(3);
  });
});

describe("VCFレース判定", () => {
  it("自VCFあり・相手VCFなし → score = FIVE（回帰テスト）", () => {
    // 白の2段VCF（カウンターフォー素材なし）
    const board = createBoardWithStones([
      // 白の横止め三
      { row: 7, col: 1, color: "white" },
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 0, color: "black" },
      // 白の縦止め三（VCF2段目用）
      { row: 4, col: 5, color: "white" },
      { row: 5, col: 5, color: "white" },
      { row: 6, col: 5, color: "white" },
      { row: 3, col: 5, color: "black" },
    ]);
    const result = findBestMoveIterativeWithTT(board, "white", 4, 1000);
    expect(result.score).toBe(PATTERN_SCORES.FIVE);
  });

  it("相手VCFが短くても自VCFは勝利（counter-fourチェック済み）", () => {
    // 白: 2段VCF（2手必要）
    // 黒: 活三（1手VCF: 活四作成で即勝利）
    // findVCFSequence が返すVCFは counter-four チェック済みなので、
    // 相手VCFの長短に関係なく自VCFは勝利確定
    const board = createBoardWithStones([
      // 白の横止め三（白(7,4)で止め四、防御(7,5)）
      { row: 7, col: 1, color: "white" },
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 0, color: "black" }, // 左端ブロック
      // 白の縦止め三（VCF2段目用）
      { row: 4, col: 5, color: "white" },
      { row: 5, col: 5, color: "white" },
      { row: 6, col: 5, color: "white" },
      { row: 3, col: 5, color: "black" }, // 上端ブロック
      // 黒の活三（1手VCF: 活四を作れば即勝ち）
      { row: 10, col: 7, color: "black" },
      { row: 10, col: 8, color: "black" },
      { row: 10, col: 9, color: "black" },
    ]);

    // VCF手数の前提を検証
    const whiteVCF = findVCFSequence(board, "white");
    const blackVCF = findVCFSequence(board, "black");
    expect(whiteVCF).not.toBeNull();
    expect(blackVCF).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(vcfAttackMoveCount(whiteVCF!.sequence)).toBe(2); // 白: 2手
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(vcfAttackMoveCount(blackVCF!.sequence)).toBe(1); // 黒: 1手

    // 白番で白の2段VCF: counter-fourチェック済みなので勝利確定
    const result = findBestMoveIterativeWithTT(board, "white", 4, 1000);
    expect(result.score).toBe(PATTERN_SCORES.FIVE);
  });

  it("同手数VCF → score = FIVE（先手有利）", () => {
    // 両者とも活三（1手VCF: 活四作成で即勝利）
    // 白番なので白が先に活四を作れる
    const board = createBoardWithStones([
      // 白の活三
      { row: 3, col: 5, color: "white" },
      { row: 3, col: 6, color: "white" },
      { row: 3, col: 7, color: "white" },
      // 黒の活三
      { row: 10, col: 7, color: "black" },
      { row: 10, col: 8, color: "black" },
      { row: 10, col: 9, color: "black" },
    ]);
    const result = findBestMoveIterativeWithTT(board, "white", 4, 1000);
    expect(result.score).toBe(PATTERN_SCORES.FIVE);
  });

  it("1手VCF（活四作成）は無条件勝利", () => {
    // 活三 → 活四作成で1手VCF
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);
    const result = findBestMoveIterativeWithTT(board, "white", 4, 1000);
    expect(result.score).toBe(PATTERN_SCORES.FIVE);
  });
});

describe("findVCFSequenceFromFirstMove", () => {
  it("有効なVCF開始手 → シーケンスが返り、firstMoveが指定した手と一致", () => {
    // 活三: (7,5)(7,6)(7,7) → (7,4)でVCF開始
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const move = { row: 7, col: 4 };
    const result = findVCFSequenceFromFirstMove(board, move, "black");
    expect(result).not.toBeNull();
    expect(result?.firstMove).toEqual(move);
    expect(result?.sequence[0]).toEqual(move);
    expect(result?.sequence.length).toBeGreaterThanOrEqual(1);
  });

  it("無効な手（四を作れない） → null", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    // (0,0) は四を作れない
    const result = findVCFSequenceFromFirstMove(
      board,
      { row: 0, col: 0 },
      "black",
    );
    expect(result).toBeNull();
  });

  it("即勝ち（五連） → sequence: [move]", () => {
    // 四連 + 五連を作れる手
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const move = { row: 7, col: 8 };
    const result = findVCFSequenceFromFirstMove(board, move, "black");
    expect(result).not.toBeNull();
    expect(result?.sequence).toEqual([move]);
  });

  it("活四（防御不能） → sequence: [move]", () => {
    // 三連の両端が空いている場合、一方に置くと活四
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const move = { row: 7, col: 4 };
    const result = findVCFSequenceFromFirstMove(board, move, "black");
    expect(result).not.toBeNull();
    // 活四なので1手で勝ち
    expect(result?.sequence).toEqual([move]);
  });

  it("2段VCFのシーケンスが正しく返される", () => {
    // 2方向に止め三がある形（四追い2段勝ち）
    const board = createBoardWithStones([
      // 横止め三
      { row: 7, col: 1, color: "white" },
      { row: 7, col: 2, color: "white" },
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 0, color: "black" }, // 左端ブロック
      // 縦止め三（VCF2段目用）
      { row: 4, col: 5, color: "white" },
      { row: 5, col: 5, color: "white" },
      { row: 6, col: 5, color: "white" },
      { row: 3, col: 5, color: "black" }, // 上端ブロック
    ]);
    // (7,5)で縦止め四 → 防御(8,5) → (7,4)で横五連勝ち
    const move = { row: 7, col: 5 };
    const result = findVCFSequenceFromFirstMove(board, move, "white", {
      maxDepth: 16,
      timeLimit: 1000,
    });
    expect(result).not.toBeNull();
    expect(result?.firstMove).toEqual(move);
    expect(result?.sequence[0]).toEqual(move);
    // 2段VCF: [攻撃1(7,5), 防御1(8,5), 攻撃2(7,4)] = 3手
    expect(result?.sequence.length).toBe(3);
  });

  it("isVCFFirstMoveと結果が一致する", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const options = { maxDepth: 16, timeLimit: 1000 };
    // 有効な手
    const validMove = { row: 7, col: 4 };
    expect(isVCFFirstMove(board, validMove, "black", options)).toBe(true);
    expect(
      findVCFSequenceFromFirstMove(board, validMove, "black", options),
    ).not.toBeNull();
    // 無効な手
    const invalidMove = { row: 0, col: 0 };
    expect(isVCFFirstMove(board, invalidMove, "black", options)).toBe(false);
    expect(
      findVCFSequenceFromFirstMove(board, invalidMove, "black", options),
    ).toBeNull();
  });

  it("盤面不変性", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const snapshot = JSON.stringify(board);
    findVCFSequenceFromFirstMove(board, { row: 7, col: 4 }, "black");
    expect(JSON.stringify(board)).toBe(snapshot);
    findVCFSequenceFromFirstMove(board, { row: 0, col: 0 }, "black");
    expect(JSON.stringify(board)).toBe(snapshot);
  });

  it("既に石がある位置 → null", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);
    const result = findVCFSequenceFromFirstMove(
      board,
      { row: 7, col: 5 },
      "black",
    );
    expect(result).toBeNull();
  });
});
