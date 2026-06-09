/**
 * patterns プリミティブの Zig⇄TS パリティ（#37 P4 PR-A）
 *
 * threat_wasm（= jump_patterns.zig）と TS 実装（patterns.ts）が合法局面で完全一致する
 * ことを保証する。物理削除（#43）前に Zig が TS と同値であることの安全網。
 *
 * 性能のため本体パリティは「候補配置ごとに cells を1回同期 → raw wasm を全方向呼ぶ」方式
 * （adapter は呼び出しごとに再同期するためループ照合に不向き）。adapter の配線（同期・色変換・
 * バッファ読み出し）は末尾の smoke テストで別途検証する。
 */
import { describe, expect, it } from "vitest";

import type { BoardState, Position, StoneColor } from "@/types/game";

import { checkFive, createEmptyBoard } from "@/logic/renjuRules/core";
import { checkForbiddenMove } from "@/logic/renjuRules/forbiddenMoves";
import {
  checkJumpFour as checkJumpFourTs,
  checkJumpThree as checkJumpThreeTs,
  checkStraightFour as checkStraightFourTs,
  getConsecutiveThreeStraightFourPoints as getConsecutiveTs,
  getJumpThreeStraightFourPoints as getJumpThreeTs,
} from "@/logic/renjuRules/patterns";

import type { ThreatWasmContext } from "./threatLoader";

import {
  checkJumpFour,
  checkJumpThree,
  checkStraightFour,
  getConsecutiveThreeStraightFourPoints,
  getJumpThreeStraightFourPoints,
} from "./patternsAdapter";
import { getThreatWasm, preloadThreatWasm } from "./threatAdapter";
import { CELL } from "./types";

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

function nearStone(board: BoardState, r: number, c: number): boolean {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || rr > 14 || cc < 0 || cc > 14) {
        continue;
      }
      if (board[rr]?.[cc]) {
        return true;
      }
    }
  }
  return false;
}

function playRandomLegalGame(rng: () => number, maxPly: number): BoardState[] {
  const board = createEmptyBoard();
  board[7]![7] = "black";
  const snapshots: BoardState[] = [];
  let color: StoneColor = "white";

  for (let ply = 1; ply < maxPly; ply++) {
    const cands: Position[] = [];
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        if (board[r]?.[c] || !nearStone(board, r, c)) {
          continue;
        }
        if (color === "black" && checkForbiddenMove(board, r, c).isForbidden) {
          continue;
        }
        cands.push({ row: r, col: c });
      }
    }
    if (cands.length === 0) {
      break;
    }
    const pick = cands[Math.floor(rng() * cands.length)]!;
    board[pick.row]![pick.col] = color;
    snapshots.push(board.map((row) => [...row]) as BoardState);
    if (checkFive(board, pick.row, pick.col, color)) {
      break;
    }
    color = color === "black" ? "white" : "black";
  }
  return snapshots;
}

function syncCells(w: ThreatWasmContext, board: BoardState): void {
  w.boardInit();
  for (let row = 0; row < 15; row++) {
    const boardRow = board[row];
    if (!boardRow) {
      continue;
    }
    for (let col = 0; col < 15; col++) {
      const v = boardRow[col];
      if (v === "black") {
        w.boardSet(row, col, CELL.BLACK);
      } else if (v === "white") {
        w.boardSet(row, col, CELL.WHITE);
      }
    }
  }
}

function readPoints(w: ThreatWasmContext): string {
  const mem = new Uint8Array(w.memory.buffer);
  const off = w.getPatternPointsBuffer();
  const count = mem[off] ?? 0;
  const pts: string[] = [];
  let o = off + 1;
  for (let i = 0; i < count; i++) {
    pts.push(`${mem[o] ?? 0},${mem[o + 1] ?? 0}`);
    o += 2;
  }
  return pts.sort().join("|");
}

function normTs(positions: Position[]): string {
  return positions
    .map((p) => `${p.row},${p.col}`)
    .sort()
    .join("|");
}

await preloadThreatWasm();

describe("patterns primitives parity (#37 P4 PR-A)", () => {
  it("raw wasm == TS（全局面・近傍空き点・全8方向・両色）", () => {
    const w = getThreatWasm()!;
    const COLORS: ("black" | "white")[] = ["black", "white"];
    const GAMES = 40;
    let seed = 0xbeef1234;
    const mismatches: string[] = [];

    for (let g = 0; g < GAMES && mismatches.length < 20; g++) {
      const rng = mulberry32(seed);
      seed = (seed + 0x9e3779b1) | 0;
      const snaps = playRandomLegalGame(rng, 50);

      for (const board of snaps) {
        for (let r = 0; r < 15; r++) {
          const boardRow = board[r];
          if (!boardRow) {
            continue;
          }
          for (let c = 0; c < 15; c++) {
            if (boardRow[c] || !nearStone(board, r, c)) {
              continue;
            }
            for (const color of COLORS) {
              boardRow[c] = color;
              syncCells(w, board); // 候補配置ごとに1回だけ同期
              const ce = color === "black" ? CELL.BLACK : CELL.WHITE;
              for (let dir = 0; dir < 8; dir++) {
                const pairs: [string, boolean, boolean][] = [
                  [
                    "jumpFour",
                    w.checkJumpFourWasm(r, c, dir, ce) !== 0,
                    checkJumpFourTs(board, r, c, dir, color),
                  ],
                  [
                    "jumpThree",
                    w.checkJumpThreeWasm(r, c, dir, ce) !== 0,
                    checkJumpThreeTs(board, r, c, dir, color),
                  ],
                  [
                    "straightFour",
                    w.checkStraightFourWasm(r, c, dir, ce) !== 0,
                    checkStraightFourTs(board, r, c, dir, color),
                  ],
                ];
                for (const [name, wb, tb] of pairs) {
                  if (wb !== tb && mismatches.length < 20) {
                    mismatches.push(
                      `g=${g} (${r},${c},${color},dir=${dir}) ${name} wasm=${wb} ts=${tb}`,
                    );
                  }
                }
                w.getConsecutiveThreeStraightFourPointsWasm(r, c, dir, ce);
                const wCons = readPoints(w);
                const tCons = normTs(getConsecutiveTs(board, r, c, dir, color));
                if (wCons !== tCons && mismatches.length < 20) {
                  mismatches.push(
                    `g=${g} (${r},${c},${color},dir=${dir}) consecutive wasm=[${wCons}] ts=[${tCons}]`,
                  );
                }
                w.getJumpThreeStraightFourPointsWasm(r, c, dir, ce);
                const wJump = readPoints(w);
                const tJump = normTs(getJumpThreeTs(board, r, c, dir, color));
                if (wJump !== tJump && mismatches.length < 20) {
                  mismatches.push(
                    `g=${g} (${r},${c},${color},dir=${dir}) jumpThree wasm=[${wJump}] ts=[${tJump}]`,
                  );
                }
              }
              boardRow[c] = null;
            }
          }
        }
      }
    }

    expect(mismatches, mismatches.join("\n")).toEqual([]);
  }, 30000);

  it("adapter 配線 == TS（同期・色変換・バッファ読み出し）", () => {
    // 跳び三 ●_●● を作る局面で adapter 経路を検証
    const board = createEmptyBoard();
    board[7]![5] = "black";
    board[7]![6] = "black";
    board[7]![8] = "black"; // (7,7) 配置で _●●_●_ 系
    const mismatches: string[] = [];
    for (let dir = 0; dir < 8; dir++) {
      for (const color of ["black", "white"] as const) {
        board[7]![7] = color;
        const cases: [string, boolean, boolean][] = [
          [
            "jumpFour",
            checkJumpFour(board, 7, 7, dir, color),
            checkJumpFourTs(board, 7, 7, dir, color),
          ],
          [
            "jumpThree",
            checkJumpThree(board, 7, 7, dir, color),
            checkJumpThreeTs(board, 7, 7, dir, color),
          ],
          [
            "straightFour",
            checkStraightFour(board, 7, 7, dir, color),
            checkStraightFourTs(board, 7, 7, dir, color),
          ],
        ];
        for (const [name, w, t] of cases) {
          if (w !== t) {
            mismatches.push(`dir=${dir} ${color} ${name} adapter=${w} ts=${t}`);
          }
        }
        const wc = normTs(
          getConsecutiveThreeStraightFourPoints(board, 7, 7, dir, color),
        );
        const tc = normTs(getConsecutiveTs(board, 7, 7, dir, color));
        if (wc !== tc) {
          mismatches.push(
            `dir=${dir} ${color} consecutive adapter=[${wc}] ts=[${tc}]`,
          );
        }
        const wj = normTs(
          getJumpThreeStraightFourPoints(board, 7, 7, dir, color),
        );
        const tj = normTs(getJumpThreeTs(board, 7, 7, dir, color));
        if (wj !== tj) {
          mismatches.push(
            `dir=${dir} ${color} jumpThree adapter=[${wj}] ts=[${tj}]`,
          );
        }
        board[7]![7] = null;
      }
    }
    expect(mismatches, mismatches.join("\n")).toEqual([]);
  });
});
