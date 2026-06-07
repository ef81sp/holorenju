/**
 * 禁手アダプタ（#37 P1）のテスト。
 *
 * wasm 経由の `isForbiddenForBlack` が、全空き点で TS `checkForbiddenMove(...).isForbidden`
 * と一致すること（#21 パリティの実利用面での担保）と、wasm 未注入時の TS フォールバックを検証。
 */
import { afterEach, describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { checkForbiddenMove } from "@/logic/renjuRules/forbiddenMoves";

import {
  isForbiddenForBlack,
  preloadForbiddenWasm,
  setForbiddenWasmForTest,
} from "./forbiddenAdapter";

// 禁手が絡む代表局面
const RECORDS = [
  "H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9 J11",
  "H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12",
];

// wasm を1回ロード（テスト全体で共有）
await preloadForbiddenWasm();

afterEach(async () => {
  // 各テスト後に wasm を復帰（fallback テストで未注入にするため）
  await preloadForbiddenWasm();
});

describe("forbiddenAdapter (#37 P1)", () => {
  it.each(RECORDS)("wasm == TS（全空き点・黒）: %s", async (record) => {
    await preloadForbiddenWasm();
    const { board } = createBoardFromRecord(record);
    const mismatches: string[] = [];
    for (let row = 0; row < 15; row++) {
      const boardRow = board[row];
      if (!boardRow) {
        continue;
      }
      for (let col = 0; col < 15; col++) {
        if (boardRow[col]) {
          continue;
        }
        const wasmResult = isForbiddenForBlack(board, row, col);
        const tsResult = checkForbiddenMove(board, row, col).isForbidden;
        if (wasmResult !== tsResult) {
          mismatches.push(`(${row},${col}): wasm=${wasmResult} ts=${tsResult}`);
        }
      }
    }
    expect(mismatches, mismatches.join("\n")).toEqual([]);
  });

  it("wasm 未ロード時は TS フォールバックする", () => {
    setForbiddenWasmForTest(undefined);
    const { board } = createBoardFromRecord(RECORDS[0]!);
    for (let row = 0; row < 15; row++) {
      const boardRow = board[row];
      if (!boardRow) {
        continue;
      }
      for (let col = 0; col < 15; col++) {
        if (boardRow[col]) {
          continue;
        }
        expect(isForbiddenForBlack(board, row, col)).toBe(
          checkForbiddenMove(board, row, col).isForbidden,
        );
      }
    }
  });
});
