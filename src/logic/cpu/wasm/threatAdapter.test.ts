/**
 * 脅威分類アダプタ（#37 P3 PR2）のテスト。
 *
 * wasm 経由の `classifyThreat`（= vct.classifyThreat）が、全空き点・両色で TS
 * `createsFour` / `createsOpenThree` と一致することを検証。**黒長連除外**を踏むため、
 * 決定的乱数局面（高密度含む）で網羅する（renjuParity #21 と同方針）。wasm 未注入時の
 * TS フォールバックも検証。
 */
import { describe, expect, it } from "vitest";

import type { BoardState, Position, StoneColor } from "@/types/game";

import { detectOpponentThreats as detectOpponentThreatsTs } from "@/logic/cpu/evaluation";
import { createsFourThree as createsFourThreeTs } from "@/logic/cpu/evaluation/winningPatterns";
import {
  createsFour as createsFourTs,
  createsOpenThree as createsOpenThreeTs,
} from "@/logic/cpu/search/threatMoves";
import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules/core";

import {
  classifyThreat,
  createsFourThree,
  detectOpponentThreats,
  preloadThreatWasm,
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

  const sortPos = (a: Position, b: Position): number =>
    a.row - b.row || a.col - b.col;
  const normalizeThreats = (t: {
    openFours: Position[];
    fours: Position[];
    openThrees: Position[];
    mises: Position[];
    doubleThrees: Position[];
  }): unknown => ({
    openFours: [...t.openFours].sort(sortPos),
    fours: [...t.fours].sort(sortPos),
    openThrees: [...t.openThrees].sort(sortPos),
    mises: [...t.mises].sort(sortPos),
    doubleThrees: [...t.doubleThrees].sort(sortPos),
  });

  // detectOpponentThreats は**合法な実戦局面**で照合する。
  // 非合法盤（多重四/長連/盤端の不能配置）では Zig と TS の合成ロジックが分岐しうるが、
  // review が処理するのは合法局面のみ（実測: 実戦棋譜の全手数前置・両色で 100% 一致、
  // 非合法ランダム盤のみ不一致）。classifyThreat は per-point プリミティブで非合法盤でも
  // 一致するため、上の乱数照合（高密度=黒長連）はそのまま維持している。
  const LEGAL_RECORDS = [
    "H8 H9 I9 I8 G7 F6 G10 G9 F9 H11 H7 F7 F10 G8 I10 H10 K11 J10 F8 K9 " +
      "I11 I13 H6 E9 F11 F12 I5 J4 G5 H5 I7 J8 J6 J7 K7 L8 F4 E3 G3 H4 I6 K6 L5",
    "H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12",
    "H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9 J11",
  ];

  it.each(LEGAL_RECORDS)(
    "detectOpponentThreats: wasm == TS（実戦棋譜 全手数前置・両色）: %s",
    async (record) => {
      await preloadThreatWasm();
      const moves = record.trim().split(/\s+/);
      for (let mc = 1; mc <= moves.length; mc++) {
        const { board } = createBoardFromRecord(moves.slice(0, mc).join(" "));
        for (const color of COLORS) {
          const w = normalizeThreats(detectOpponentThreats(board, color));
          const ts = normalizeThreats(detectOpponentThreatsTs(board, color));
          expect(w, `mc=${mc} color=${color}`).toEqual(ts);
        }
      }
    },
  );

  // issue #121: 黒の偽跳び四（ギャップ埋めが長連）。
  // 跳び四の LUT/`checkJumpFour` は中心 ±4 マスの窓しか見ないため、窓の外の自石で
  // ギャップ埋めが 6 連になる形を四と誤判定していた。TS・Zig 双方を五点列挙
  // （`collectLineFivePoints`）に揃えたので、この形でも一致する。
  it("detectOpponentThreats: wasm == TS（issue #121 黒の偽跳び四）", async () => {
    await preloadThreatWasm();
    // 8 行目に黒 C8 D8 _ F8 G8 H8。E8 を埋めると C8..H8 の 6 連＝長連。
    for (const color of COLORS) {
      const board = createEmptyBoard();
      const [, , , , , , , boardRow] = board;
      for (const col of [2, 3, 5, 6, 7]) {
        if (boardRow) {
          boardRow[col] = color;
        }
      }
      const w = normalizeThreats(detectOpponentThreats(board, color));
      const ts = normalizeThreats(detectOpponentThreatsTs(board, color));
      expect(w, `color=${color}`).toEqual(ts);
      // 黒は四ではない（受け 0 点）／白は長連 OK なので跳び四
      expect(
        detectOpponentThreats(board, color).fours,
        `color=${color}`,
      ).toEqual(color === "black" ? [] : [{ row: 7, col: 4 }]);
    }
  });

  // issue #121: ミセ生成（四三判定）でも偽跳び四が四に数えられていた。
  // 横 8 行目 C8 D8 _ F8 G8 [H8] + 縦 H10 H9 [H8] で、H8 は「横=偽四 + 縦=活三」に見える。
  it("createsFourThree: wasm == TS（issue #121 黒の偽跳び四）", async () => {
    await preloadThreatWasm();
    for (const color of COLORS) {
      const board = createEmptyBoard();
      for (const [r, c] of [
        [7, 2],
        [7, 3],
        [7, 5],
        [7, 6],
        [5, 7],
        [6, 7],
      ] as const) {
        const boardRow = board[r];
        // eslint-disable-next-line max-depth
        if (boardRow) {
          boardRow[c] = color;
        }
      }
      const w = createsFourThree(board, 7, 7, color);
      const ts = createsFourThreeTs(board, 7, 7, color);
      expect(w, `color=${color}`).toBe(ts);
      // 黒は横が四ではないので四三ではない／白は長連 OK なので四三
      expect(w, `color=${color}`).toBe(color !== "black");
    }
  });

  it.each(LEGAL_RECORDS)(
    "createsFourThree: wasm == TS（実戦棋譜 全手数前置・全空き点・両色）: %s",
    async (record) => {
      await preloadThreatWasm();
      const moves = record.trim().split(/\s+/);
      const mismatches: string[] = [];
      // 計算量を抑えるため代表的な手数（中盤以降で四三が出やすい）を間引いて検査
      for (let mc = 6; mc <= moves.length; mc += 3) {
        const { board } = createBoardFromRecord(moves.slice(0, mc).join(" "));
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
              const w = createsFourThree(board, row, col, color);
              const ts = createsFourThreeTs(board, row, col, color);
              if (w !== ts) {
                mismatches.push(
                  `mc=${mc} (${row},${col},${color}) w=${w} ts=${ts}`,
                );
              }
            }
          }
        }
      }
      expect(mismatches, mismatches.join("\n")).toEqual([]);
    },
  );
});
