/**
 * 偽 VCF（五点 0 個の「四」）の回帰テスト（issue #124・実 WASM）
 *
 * `createsFour` と受け点 `getFourDefensePosition` の基準が食い違っていたため、
 * 「四ですらない手」が「止められない四」として VCF 勝ちになっていた。
 * 対局 CPU も通る Zig 側の VCF 経路（`vcf.zig`）で再現局面を凍結する。
 */

import { describe, expect, it } from "vitest";

import type { BoardState, Position, StoneColor } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";

import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";

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

/**
 * 8 行目: A8白 B8白 C8黒 D8黒 E8黒 F8空 G8空 H8黒 I8空 J8黒 K8空 L8白
 *
 * 黒が G8 に打っても `W W B B B _ B B _ B _ W` で五点はゼロ
 * （F8 は C8..H8 の 6 連＝長連、I8 は 4 連）。四ですらない。
 */
function buildIssue124Board(): BoardState {
  const board = createEmptyBoard();
  place(board, ["C8", "D8", "E8", "H8", "J8"], "black");
  place(board, ["A8", "B8", "L8"], "white");
  return board;
}

/**
 * VCF の最大深さ。0 を渡すと `vcf.zig` の反復深化ループが 1 度も回らず
 * 常に null になる（テストが空振りする）ので、必ず 1 以上を渡すこと。
 */
const MAX_DEPTH = 20;
const TIME_LIMIT_MS = 5000;

describe("VCF: 五点 0 個の偽四で勝ちにしない（issue #124）", () => {
  it("探索パラメータが空振りしていない（陽性コントロール）", async () => {
    const engine = new WasmSearchEngine(await loadWasmModule());
    // 黒の連続四 D8-E8-F8-G8。H8 で五 ＝ 自明な VCF。
    const board = createEmptyBoard();
    place(board, ["D8", "E8", "F8", "G8"], "black");

    const result = engine.findVCFSequence(
      board,
      "black",
      MAX_DEPTH,
      TIME_LIMIT_MS,
      0,
    );
    // 活四なので 1 手（C8 / H8 のどちらか）で VCF 成立
    expect(result?.sequence).toHaveLength(1);
  });

  it("黒に VCF は無い（旧実装は G8 の1手 VCF を返していた）", async () => {
    const engine = new WasmSearchEngine(await loadWasmModule());
    const board = buildIssue124Board();

    expect(
      engine.findVCFSequence(board, "black", MAX_DEPTH, TIME_LIMIT_MS, 0),
    ).toBeNull();
  });

  it("G8 を初手に指定しても VCF にならない", async () => {
    const engine = new WasmSearchEngine(await loadWasmModule());
    const board = buildIssue124Board();

    expect(
      engine.findVCFSequenceFromFirstMove(
        board,
        at("G8"),
        "black",
        MAX_DEPTH,
        TIME_LIMIT_MS,
        0,
      ),
    ).toBeNull();
  });
});
