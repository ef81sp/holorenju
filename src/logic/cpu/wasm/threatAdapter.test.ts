/**
 * 脅威分類アダプタ（#37 P3 PR2）のテスト。
 *
 * wasm 経由の `classifyThreat`（= vct.classifyThreat）が、全空き点・両色で TS
 * `createsFour` / `createsOpenThree` と一致することを検証。**黒長連除外**を踏むため、
 * 決定的乱数局面（高密度含む）で網羅する（renjuParity #21 と同方針）。wasm 未注入時の
 * TS フォールバックも検証。
 */
import { afterEach, describe, expect, it } from "vitest";

import type { BoardState, StoneColor } from "@/types/game";

import {
  createsFour as createsFourTs,
  createsOpenThree as createsOpenThreeTs,
} from "@/logic/cpu/search/threatMoves";
import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules/core";

import {
  classifyThreat,
  preloadThreatWasm,
  setThreatWasmForTest,
} from "./threatAdapter";

/** 決定的 PRNG（mulberry32、外部依存なし） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 決定的乱数局面（黒白混在・複数密度。非合法局面でも可。黒長連を踏むため高密度を含む） */
function randomBoards(): { name: string; board: BoardState }[] {
  const out: { name: string; board: BoardState }[] = [];
  const densities = [0.25, 0.4, 0.55];
  let seed = 0x1234abcd;
  for (const density of densities) {
    for (let n = 0; n < 8; n++) {
      const rng = mulberry32(seed);
      seed = (seed + 0x9e3779b1) | 0;
      const board = createEmptyBoard();
      for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
          if (rng() < density) {
            const br = board[r];
            if (br) {
              br[c] = rng() < 0.5 ? "black" : "white";
            }
          }
        }
      }
      out.push({ name: `rand d=${density} #${n}`, board });
    }
  }
  return out;
}

function kifuBoards(): { name: string; board: BoardState }[] {
  const records = [
    "H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9 J11",
    "H8 H9 I9 I8 G7 F6 G10 G9 F9 H11 H7 F7 F10 G8 I10 H10 K11 J10 F8 K9",
  ];
  return records.map((rec, i) => ({
    name: `kifu#${i}`,
    board: createBoardFromRecord(rec).board,
  }));
}

// wasm を1回ロード（テスト全体で共有）
await preloadThreatWasm();

afterEach(async () => {
  // 各テスト後に wasm を復帰（fallback テストで未注入にするため）
  await preloadThreatWasm();
});

const corpus = [...kifuBoards(), ...randomBoards()];
const COLORS: StoneColor[] = ["black", "white"];

describe("threatAdapter (#37 P3 PR2)", () => {
  it.each(corpus)(
    "wasm == TS（全空き点・両色 createsFour/createsOpenThree）: $name",
    async ({ board }) => {
      await preloadThreatWasm();
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
          for (const color of COLORS) {
            // 契約: 石を配置済みで判定（TS createsFour と同一規約）
            boardRow[col] = color;
            const w = classifyThreat(board, row, col, color);
            const tsFour = createsFourTs(board, row, col, color);
            const tsOpen = createsOpenThreeTs(board, row, col, color);
            boardRow[col] = null;
            if (w.createsFour !== tsFour) {
              mismatches.push(
                `(${row},${col},${color}) four: wasm=${w.createsFour} ts=${tsFour}`,
              );
            }
            if (w.createsOpenThree !== tsOpen) {
              mismatches.push(
                `(${row},${col},${color}) open3: wasm=${w.createsOpenThree} ts=${tsOpen}`,
              );
            }
          }
        }
      }
      expect(mismatches, mismatches.join("\n")).toEqual([]);
    },
  );

  it("wasm 未ロード時は TS フォールバックする", () => {
    setThreatWasmForTest(undefined);
    const { board } = kifuBoards()[0]!;
    for (let row = 0; row < 15; row++) {
      const boardRow = board[row];
      if (!boardRow) {
        continue;
      }
      for (let col = 0; col < 15; col++) {
        if (boardRow[col]) {
          continue;
        }
        boardRow[col] = "black";
        const w = classifyThreat(board, row, col, "black");
        expect(w.createsFour).toBe(createsFourTs(board, row, col, "black"));
        expect(w.createsOpenThree).toBe(
          createsOpenThreeTs(board, row, col, "black"),
        );
        boardRow[col] = null;
      }
    }
  });
});
