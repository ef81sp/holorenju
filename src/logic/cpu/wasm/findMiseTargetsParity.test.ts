/**
 * findMiseTargets の Zig⇄TS パリティ（#37 P3 PR5b）
 *
 * 決定的なランダム合法自己対局で生成した局面の、各空き点にミセ手を仮置きし、
 * Zig `evaluate.findMiseTargets` と TS `findMiseTargets` が同じ四三ターゲット集合を
 * 返すことを照合する faithful な等価テスト。列挙順は座標ソートで正規化して比較する。
 *
 * createsFourThree のパリティ（[[createsFourThreeParity.test.ts]] 相当）が前提。
 */
import { describe, expect, it } from "vitest";

import type { BoardState, Position, StoneColor } from "@/types/game";

import { findMiseTargets as findMiseTargetsTs } from "@/logic/cpu/evaluation/miseTactics";
import { checkFive, createEmptyBoard } from "@/logic/renjuRules/core";
import { checkForbiddenMove } from "@/logic/renjuRules/forbiddenMoves";

import { findMiseTargets, preloadThreatWasm } from "./threatAdapter";

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

const sortPos = (a: Position, b: Position): number =>
  a.row - b.row || a.col - b.col;
const norm = (ps: Position[]): string =>
  [...ps]
    .sort(sortPos)
    .map((p) => `${p.row},${p.col}`)
    .join("|");

await preloadThreatWasm();

describe("findMiseTargets parity (#37 P3 PR5b)", () => {
  it("合法自己対局の各局面・近傍空き点にミセ手を仮置きして Zig==TS", () => {
    const COLORS: StoneColor[] = ["black", "white"];
    const GAMES = 12;
    let seed = 0xa11ce777;
    const mismatches: string[] = [];

    for (let g = 0; g < GAMES; g++) {
      const rng = mulberry32(seed);
      seed = (seed + 0x9e3779b1) | 0;
      const snaps = playRandomLegalGame(rng, 45);

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
              // ミセ手を仮置きして契約（石を置いた状態）を満たす
              boardRow[c] = color;
              const w = norm(findMiseTargets(board, r, c, color));
              const t = norm(findMiseTargetsTs(board, r, c, color));
              boardRow[c] = null;
              if (w !== t && mismatches.length < 20) {
                mismatches.push(
                  `g=${g} (${r},${c},${color}) wasm=[${w}] ts=[${t}]`,
                );
              }
            }
          }
        }
      }
    }

    expect(mismatches, mismatches.join("\n")).toEqual([]);
  }, 60000);
});
