/**
 * findDoubleMiseMoves の Zig⇄TS パリティ（#37 P3 PR5b）
 *
 * 決定的なランダム合法自己対局で生成した各局面・両色で、Zig `evaluate.findDoubleMiseMoves`
 * と TS `findDoubleMiseMoves` が同じ両ミセ手集合を返すことを照合する faithful な等価テスト。
 * 列挙順は座標ソートで正規化して比較する。
 *
 * createsFourThree / findMiseTargets のパリティが前提（両ミセ判定はこれらに依存）。
 */
import { describe, expect, it } from "vitest";

import type { BoardState, Position, StoneColor } from "@/types/game";

import { findDoubleMiseMoves as findDoubleMiseMovesTs } from "@/logic/cpu/evaluation/miseTactics";
import { checkFive, createEmptyBoard } from "@/logic/renjuRules/core";
import { checkForbiddenMove } from "@/logic/renjuRules/forbiddenMoves";

import { findDoubleMiseMoves, preloadThreatWasm } from "./threatAdapter";

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

describe("findDoubleMiseMoves parity (#37 P3 PR5b)", () => {
  it("合法自己対局の各局面・両色で Zig==TS", () => {
    const COLORS: StoneColor[] = ["black", "white"];
    const GAMES = 40;
    let seed = 0xd00d1e42;
    const mismatches: string[] = [];

    for (let g = 0; g < GAMES; g++) {
      const rng = mulberry32(seed);
      seed = (seed + 0x9e3779b1) | 0;
      const snaps = playRandomLegalGame(rng, 45);

      for (const board of snaps) {
        for (const color of COLORS) {
          const w = norm(findDoubleMiseMoves(board, color));
          const t = norm(findDoubleMiseMovesTs(board, color));
          if (w !== t && mismatches.length < 20) {
            mismatches.push(`g=${g} ${color} wasm=[${w}] ts=[${t}]`);
          }
        }
      }
    }

    expect(mismatches, mismatches.join("\n")).toEqual([]);
  }, 60000);
});
