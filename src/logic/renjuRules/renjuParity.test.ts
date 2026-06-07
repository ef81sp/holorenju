/**
 * 連珠ルール TS⇄Zig パリティテスト（Issue #21）
 *
 * 連珠の禁手・パターン判定は TS (`renjuRules/`) と Zig (`zig/src/`) に二重実装されている。
 * 片方だけ変更するとサイレントに食い違う（#19 で実害）。本テストは同一局面・同一点・同一色で
 * 両実装の判定を突き合わせ、ドリフトを「失敗するテスト」として常時検出する。
 *
 * 比較オラクル: `classifyPoint(board,row,col,color)` を TS/Zig 双方で u32 にパックして比較。
 *   ビットレイアウト: dir d (0..3) が bit [d*6 .. d*6+5] を占有
 *     +0 four / +1 open4 / +2 open3 / +3 straightFour / +4 jumpFour / +5 jumpThree
 *   禁手種別 (none0/overline1/double-four2/double-three3, 黒のみ) は bit 24-25。
 *
 * 配置規約（TS/Zig で吸収済み）:
 *   - 禁手判定は候補マスが「空き」の状態で評価（内部で黒を仮置き）。
 *   - パターン判定は候補マスに color を「配置済み」で評価（Zig checkJumpFour が生 cells の
 *     中心を same として読むため）。classifyPoint 内で配置→評価→復元する。
 *
 * 方向は TS DIRECTIONS と Zig DIRECTIONS_8 が同一規約（上0/右上1/右2/右下3/...）。
 * dir 0=縦, 1=右上斜, 2=横, 3=右下斜。
 *
 * 詳細: docs/plans/issue-21-forbidden-wasm.md
 */

import { describe, expect, it } from "vitest";

import type { WasmModuleContext } from "@/logic/cpu/wasm/types";
import type { BoardState, StoneColor } from "@/types/game";

import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";

import { createEmptyBoard } from "./core";
import { checkForbiddenMove } from "./forbiddenMoves";
import {
  checkJumpFour,
  checkJumpThree,
  checkOpenPattern,
  checkStraightFour,
  getJumpThreeStraightFourPoints,
} from "./patterns";

// ── ビットレイアウト（SSoT。Zig main.zig classifyPointWasm と一致させること）──
const BIT = {
  four: 0,
  open4: 1,
  open3: 2,
  straightFour: 3,
  jumpFour: 4,
  jumpThree: 5,
} as const;
const BITS_PER_DIR = 6;
const FORBIDDEN_SHIFT = 24;

const FORBIDDEN_TYPE_TO_NUM: Record<string, number> = {
  overline: 1,
  "double-four": 2,
  "double-three": 3,
};

const CELL_NUM: Record<StoneColor, number> = { black: 1, white: 2 };

/** BoardState を WASM の board_cells へ全同期（局面毎に1回） */
function syncBoard(wasm: WasmModuleContext, board: BoardState): void {
  wasm.boardInit();
  for (let row = 0; row < 15; row++) {
    const boardRow = board[row];
    if (!boardRow) {
      continue;
    }
    for (let col = 0; col < 15; col++) {
      const v = boardRow[col];
      if (v) {
        wasm.boardSet(row, col, CELL_NUM[v]);
      }
    }
  }
}

/** TS 側の分類オラクル（classifyPointWasm と同一レイアウト） */
function classifyPointTs(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
): number {
  let bits = 0;

  // Phase A: 禁手（候補は空き、黒のみ）
  if (color === "black") {
    const f = checkForbiddenMove(board, row, col);
    const n = f.isForbidden ? (FORBIDDEN_TYPE_TO_NUM[f.type ?? ""] ?? 0) : 0;
    bits |= n << FORBIDDEN_SHIFT;
  }

  // Phase B: パターン（候補を配置して評価し復元）
  const boardRow = board[row];
  const original = boardRow ? boardRow[col] : null;
  if (boardRow) {
    boardRow[col] = color;
  }
  for (let dir = 0; dir < 4; dir++) {
    const op = checkOpenPattern(board, row, col, dir, color);
    const sf = checkStraightFour(board, row, col, dir, color);
    const jf = checkJumpFour(board, row, col, dir, color);
    const jt = checkJumpThree(board, row, col, dir, color);
    const base = dir * BITS_PER_DIR;
    if (op.four) {
      bits |= 1 << (base + BIT.four);
    }
    if (op.open4) {
      bits |= 1 << (base + BIT.open4);
    }
    if (op.open3) {
      bits |= 1 << (base + BIT.open3);
    }
    if (sf) {
      bits |= 1 << (base + BIT.straightFour);
    }
    if (jf) {
      bits |= 1 << (base + BIT.jumpFour);
    }
    if (jt) {
      bits |= 1 << (base + BIT.jumpThree);
    }
  }
  if (boardRow) {
    boardRow[col] = original ?? null;
  }

  return bits >>> 0;
}

/** u32 を人間可読な分類へ展開（不一致時のデバッグ用） */
function explain(bits: number): Record<string, unknown> {
  const dirs: Record<string, string[]> = {};
  for (let dir = 0; dir < 4; dir++) {
    const base = dir * BITS_PER_DIR;
    const flags: string[] = [];
    for (const [name, off] of Object.entries(BIT)) {
      if (bits & (1 << (base + off))) {
        flags.push(name);
      }
    }
    if (flags.length) {
      dirs[`dir${dir}`] = flags;
    }
  }
  const forbidden = (bits >>> FORBIDDEN_SHIFT) & 0x3;
  return { dirs, forbidden };
}

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

function makeBoard(stones: [number, number, StoneColor][]): BoardState {
  const board = createEmptyBoard();
  for (const [r, c, color] of stones) {
    const br = board[r];
    if (br) {
      br[c] = color;
    }
  }
  return board;
}

/** 手作りの種局面（#19 リグレッション・禁手の核を明示投入） */
function seedBoards(): { name: string; board: BoardState }[] {
  return [
    {
      name: "#19 同方向の2飛び四 (D F H J / row5)",
      board: makeBoard([
        [5, 3, "black"],
        [5, 5, "black"],
        [5, 7, "black"],
        [5, 9, "black"],
      ]),
    },
    {
      name: "#19 ウソの四 XXXX_X (row7 cols4,5,6,9)",
      board: makeBoard([
        [7, 4, "black"],
        [7, 5, "black"],
        [7, 6, "black"],
        [7, 9, "black"],
      ]),
    },
    {
      name: "四四禁 (横3+縦3 → 中心)",
      board: makeBoard([
        [7, 4, "black"],
        [7, 5, "black"],
        [7, 6, "black"],
        [5, 7, "black"],
        [6, 7, "black"],
        [8, 7, "black"],
      ]),
    },
    {
      name: "長連禁 (4連の延長)",
      board: makeBoard([
        [7, 3, "black"],
        [7, 4, "black"],
        [7, 5, "black"],
        [7, 6, "black"],
        [7, 7, "black"],
      ]),
    },
    {
      name: "三三禁 (活三×2)",
      board: makeBoard([
        [7, 6, "black"],
        [7, 8, "black"],
        [6, 7, "black"],
        [8, 7, "black"],
      ]),
    },
  ];
}

/** 実戦譜ベースの局面 */
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

/** 決定的乱数局面（黒白混在・複数密度。非合法局面でも可） */
function randomBoards(): { name: string; board: BoardState }[] {
  const out: { name: string; board: BoardState }[] = [];
  const densities = [0.1, 0.25, 0.4];
  let seed = 0x1234abcd;
  for (const density of densities) {
    for (let n = 0; n < 12; n++) {
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

// WASM は1回だけロードして全テストで使い回す（48MB エンジン wasm）
const wasm = await loadWasmModule();

describe("連珠ルール TS⇄Zig パリティ (#21)", () => {
  it("ビットレイアウト自己検証: 横の活三のみが立つ", () => {
    // (7,6),(7,8) 黒、(7,7) に黒を置くと横(dir2)に活三
    const board = makeBoard([
      [7, 6, "black"],
      [7, 8, "black"],
    ]);
    const bits = classifyPointTs(board, 7, 7, "black");
    // 横(dir2)に open3 が立つ
    expect(bits & (1 << (2 * BITS_PER_DIR + BIT.open3))).toBeTruthy();
    // 他方向には open3 は立たない（checkStraightFour は非4連で true を返す仕様のため
    // straightFour ビットは方向問わず立ちうる。レイアウト検証は open3 の位置で行う）
    for (const dir of [0, 1, 3]) {
      expect(bits & (1 << (dir * BITS_PER_DIR + BIT.open3))).toBe(0);
    }
  });

  const corpus = [...seedBoards(), ...kifuBoards(), ...randomBoards()];

  it.each(corpus)("classifyPoint 一致: $name", ({ board }) => {
    syncBoard(wasm, board);
    const mismatches: string[] = [];
    for (let row = 0; row < 15; row++) {
      const boardRow = board[row];
      if (!boardRow) {
        continue;
      }
      for (let col = 0; col < 15; col++) {
        if (boardRow[col]) {
          continue;
        } // 空き点のみ
        for (const color of ["black", "white"] as const) {
          const ts = classifyPointTs(board, row, col, color);
          const zig = wasm.classifyPointWasm(row, col, CELL_NUM[color]) >>> 0;
          if (ts !== zig) {
            mismatches.push(
              `${formatMove({ row, col })} ${color}: TS=${JSON.stringify(
                explain(ts),
              )} Zig=${JSON.stringify(explain(zig))}`,
            );
          }
        }
      }
    }
    expect(
      mismatches,
      `TS/Zig ドリフト検出。両方を直すかルール解釈を確認せよ:\n${mismatches.join("\n")}`,
    ).toEqual([]);
  });

  it.each(corpus)("getJumpThreeStraightFourPoints 一致: $name", ({ board }) => {
    syncBoard(wasm, board);
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
        for (const color of ["black", "white"] as const) {
          for (let dir = 0; dir < 4; dir++) {
            const tsPts = getJumpThreeStraightFourPoints(
              board,
              row,
              col,
              dir,
              color,
            );
            const tsFound = tsPts.length > 0;
            const packed =
              wasm.getJumpThreeStraightFourPointsWasm(
                row,
                col,
                dir,
                CELL_NUM[color],
              ) >>> 0;
            const zigFound = (packed & 1) === 1;
            if (tsFound !== zigFound) {
              mismatches.push(
                `${formatMove({ row, col })} ${color} dir${dir}: TS found=${tsFound} Zig found=${zigFound}`,
              );
              continue;
            }
            if (tsFound) {
              const zr = (packed >>> 8) & 0xff;
              const zc = (packed >>> 16) & 0xff;
              const tp = tsPts[0]!;
              if (tp.row !== zr || tp.col !== zc) {
                mismatches.push(
                  `${formatMove({ row, col })} ${color} dir${dir}: TS=(${tp.row},${tp.col}) Zig=(${zr},${zc})`,
                );
              }
            }
          }
        }
      }
    }
    expect(mismatches, `達四点ドリフト:\n${mismatches.join("\n")}`).toEqual([]);
  });
});
