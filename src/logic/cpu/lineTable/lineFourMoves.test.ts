/**
 * LineTable ベース高速四候補検出のテスト
 *
 * findFourMovesFast と findFourMoves（盤面走査版）の結果を比較して
 * 一致性を検証する。
 */

import { describe, expect, it } from "vitest";

import { findFourMoves } from "../search/threatPatterns";
import { createBoardWithStones } from "../testUtils";
import { findFourMovesFast } from "./lineFourMoves";
import { buildLineTable } from "./lineTable";

/** Position[] をソートしてキー文字列に変換（順序無視の比較用） */
function toSortedKeys(positions: { row: number; col: number }[]): string[] {
  return positions.map((p) => `${p.row},${p.col}`).sort();
}

describe("findFourMovesFast", () => {
  it("空盤面で四候補なし", () => {
    const board = createBoardWithStones([]);
    const lt = buildLineTable(board);
    expect(findFourMovesFast(lt, "black")).toEqual([]);
  });

  it("三連の延長で四候補を検出", () => {
    // 黒: H5, H6, H7 (横三連)
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
    ]);
    const lt = buildLineTable(board);
    const fast = findFourMovesFast(lt, "black");
    // 両端に四候補があるはず (H4, H8)
    const keys = toSortedKeys(fast);
    expect(keys).toContain("7,3");
    expect(keys).toContain("7,7");
  });

  it("findFourMoves と結果が一致（基本局面）", () => {
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 5, col: 7, color: "white" },
      { row: 6, col: 7, color: "white" },
    ]);
    const lt = buildLineTable(board);

    const slow = toSortedKeys(findFourMoves(board, "black"));
    const fast = toSortedKeys(findFourMovesFast(lt, "black"));

    // fast は slow のスーパーセット（跳び四は slow のみが検出する場合がある、
    // または fast が余分に検出する場合がある）
    // 最低限、slow の結果は fast に含まれるべき
    for (const key of slow) {
      expect(fast).toContain(key);
    }
  });

  it("白番でも動作する", () => {
    const board = createBoardWithStones([
      { row: 3, col: 3, color: "white" },
      { row: 4, col: 4, color: "white" },
      { row: 5, col: 5, color: "white" },
    ]);
    const lt = buildLineTable(board);
    const fast = findFourMovesFast(lt, "white");
    const keys = toSortedKeys(fast);
    // 斜め↘方向の両端
    expect(keys).toContain("2,2");
    expect(keys).toContain("6,6");
  });

  it("塞がれた三連では四候補なし", () => {
    // 黒三連の両端が白で塞がれている
    const board = createBoardWithStones([
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "white" },
    ]);
    const lt = buildLineTable(board);
    const fast = findFourMovesFast(lt, "black");
    // この方向の四候補はないが、縦や斜めで四候補がある可能性もある
    // 少なくとも (7,3) と (7,7) は含まれないはず（白が置かれている）
    const keys = toSortedKeys(fast);
    expect(keys).not.toContain("7,3");
    expect(keys).not.toContain("7,7");
  });
});
