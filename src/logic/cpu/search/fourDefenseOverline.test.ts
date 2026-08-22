/**
 * `getFourDefensePosition` が長連ギャップを受け点として返さないことの回帰テスト
 *
 * issue #115 の Zig 側修正（`quiescence.getFourDefensePosition`）と対になる TS 側。
 * この関数は vcfPuzzle / vctValidation / vcfCheck から live で使われている。
 *
 * `findJumpGapPosition` は 5 マス窓をラインの先頭から走査して最初のギャップを返すため、
 * 同一ライン上に「埋めると長連になるギャップ」と「埋めると五になる正当なギャップ」が
 * 併存すると前者を返す。受け点はギャップを探すのではなく
 * 「その方向で埋めると五になる点」で選ぶ必要がある。
 */

import { describe, expect, it } from "vitest";

import type { BoardState, Position, StoneColor } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

import { createsFour } from "./threatMoves";
import { getFourDefensePosition } from "./threatPatterns";
import { hasVCF } from "./vcfCheck";

/** 左下原点の座標表記（例: "H8"）を配列インデックスに変換する */
function at(move: string): Position {
  const col = "ABCDEFGHIJKLMNO".indexOf(move[0] ?? "");
  const row = 15 - Number.parseInt(move.slice(1), 10);
  return { row, col };
}

function place(board: BoardState, moves: string[], color: StoneColor): void {
  for (const move of moves) {
    const { row, col } = at(move);
    const boardRow = board[row];
    if (boardRow) {
      boardRow[col] = color;
    }
  }
}

describe("getFourDefensePosition: 長連ギャップを受け点にしない（issue #115）", () => {
  it("同一ラインに長連ギャップと正当なギャップが併存するとき、五になる方を返す", () => {
    // 8 行目: G8 H8 _ J8 K8 L8 _ N8（黒）/ O8（白）
    //   I8 を埋めると G8..L8 の 6 連＝長連で五にならない
    //   M8 を埋めると J8..N8 の五 ＝ 本物の受け
    const board = createEmptyBoard();
    place(board, ["G8", "H8", "J8", "K8", "L8", "N8"], "black");
    place(board, ["O8"], "white");

    expect(getFourDefensePosition(board, at("J8"), "black")).toEqual({
      kind: "block",
      position: at("M8"),
    });
  });

  it("黒の _XXXX_ で片端が長連になる場合は活四ではなく止め四", () => {
    // C8 D8 E8 F8 _ H8（黒）: G8 は埋めると 6 連なので五点ではない。
    // 五点は B8 のみ ＝ 止め四（防御可能）。
    const board = createEmptyBoard();
    place(board, ["C8", "D8", "E8", "F8", "H8"], "black");

    expect(getFourDefensePosition(board, at("E8"), "black")).toEqual({
      kind: "block",
      position: at("B8"),
    });
  });

  it("白の同形は活四（白に長連の制限が無いので五点が2つ）", () => {
    const board = createEmptyBoard();
    place(board, ["C8", "D8", "E8", "F8", "H8"], "white");

    expect(getFourDefensePosition(board, at("E8"), "white")).toEqual({
      kind: "unstoppable",
    });
  });
});

describe("createsFour と受け点の基準一致（issue #124）", () => {
  /**
   * 8 行目: A8白 B8白 C8黒 D8黒 E8黒 F8空 G8空 H8黒 I8空 J8黒 K8空 L8白
   *
   * 黒が G8 に打つと `W W B B B _ B B _ B _ W`。
   * F8 を埋めると C8..H8 の 6 連＝長連、I8 を埋めても 4 連にしかならないので
   * 黒の五点はゼロ ＝ **四ですらない**。
   * 旧実装は「最も近いギャップ」I8 だけを長連判定に掛けていたため
   * `createsFour=true` かつ受け点 0 個 → `null` → 偽 VCF になっていた。
   */
  function buildIssue124Board(): BoardState {
    const board = createEmptyBoard();
    place(board, ["C8", "D8", "E8", "H8", "J8"], "black");
    place(board, ["A8", "B8", "L8"], "white");
    return board;
  }

  it("五点が 0 個なら四ではない", () => {
    const board = buildIssue124Board();
    place(board, ["G8"], "black");

    expect(createsFour(board, at("G8").row, at("G8").col, "black")).toBe(false);
    expect(getFourDefensePosition(board, at("G8"), "black")).toEqual({
      kind: "not_four",
    });
  });

  it("偽の四で VCF が成立しない", () => {
    const board = buildIssue124Board();

    expect(hasVCF(board, "black")).toBe(false);
  });

  it("createsFour(x) ⇔ getFourDefensePosition(x) !== not_four（不変条件）", () => {
    const base = buildIssue124Board();
    const { row } = at("A8");

    for (let col = 0; col < 15; col++) {
      if (base[row]?.[col]) {
        continue;
      }
      for (const color of ["black", "white"] as const) {
        const board = buildIssue124Board();
        const boardRow = board[row];
        if (boardRow) {
          boardRow[col] = color;
        }
        const isFour = createsFour(board, row, col, color);
        const defense = getFourDefensePosition(board, { row, col }, color);
        expect({ col, color, isFour }).toEqual({
          col,
          color,
          isFour: defense.kind !== "not_four",
        });
      }
    }
  });
});
