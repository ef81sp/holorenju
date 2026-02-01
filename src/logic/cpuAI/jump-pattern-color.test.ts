/**
 * 跳びパターン判定の色パラメータリグレッションテスト
 *
 * バグ概要:
 * - checkJumpFour, checkJumpThree が常に "black" で判定していたため、
 *   白番で相手（黒）のパターンを自分のパターンとして誤検出していた
 *
 * 修正日: 2026-02-01
 */
import { describe, it, expect } from "vitest";

import {
  checkJumpFour,
  checkJumpThree,
  createEmptyBoard,
} from "@/logic/renjuRules";

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
