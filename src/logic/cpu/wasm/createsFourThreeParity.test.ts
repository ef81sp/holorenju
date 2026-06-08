/**
 * createsFourThree の Zig⇄TS パリティ（#37 P3 / bug#1・#2 回帰防止）
 *
 * 全空き点に総当たりでミセ石を置く方式は、実戦で到達しない非合法盤（多重四・黒長連・
 * 盤端の不能配置）を生成し、未定義領域で Zig/TS が分岐するため不適。代わりに
 * **決定的なランダム合法自己対局**（黒の禁手を尊重・五で終局・近傍着手）で生成した
 * 全局面・全空き点・両色を照合する faithful な等価テストとする。
 *
 * 過去に発見・修正した2バグの回帰をこのテストが捕捉する:
 *  - bug#1: 跳び三を跳び四と同方向でも活三計上（白で四三を過剰検出）
 *  - bug#2: 黒 count==4 の長連端補正欠落（伸ばすと6連になる四を過剰検出）
 * いずれも合法局面（自己対局）で再現し、本テストが緑であることが review/CPU 双方の
 * createsFourThree 単一ソース性を担保する。
 */
import { describe, expect, it } from "vitest";

import type { BoardState, Position, StoneColor } from "@/types/game";

import { createsFourThree as createsFourThreeTs } from "@/logic/cpu/evaluation/winningPatterns";
import { checkFive, createEmptyBoard } from "@/logic/renjuRules/core";
import { checkForbiddenMove } from "@/logic/renjuRules/forbiddenMoves";

import { createsFourThree, preloadThreatWasm } from "./threatAdapter";

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

/** (r,c) が既存石の距離2以内か */
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

/** ランダム合法自己対局を1局打ち、各手後の局面スナップショットを返す */
function playRandomLegalGame(rng: () => number, maxPly: number): BoardState[] {
  const board = createEmptyBoard();
  board[7]![7] = "black";
  const snapshots: BoardState[] = [];
  let color: StoneColor = "white";

  for (let ply = 1; ply < maxPly; ply++) {
    const cands: Position[] = [];
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        if (board[r]?.[c]) {
          continue;
        }
        if (!nearStone(board, r, c)) {
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
      break; // 勝負あり
    }
    color = color === "black" ? "white" : "black";
  }
  return snapshots;
}

await preloadThreatWasm();

describe("createsFourThree parity (#37 P3)", () => {
  it("ランダム合法自己対局の全局面・全空き点・両色で Zig==TS", () => {
    const COLORS: StoneColor[] = ["black", "white"];
    const GAMES = 80;
    let seed = 0xc0ffee01;
    const mismatches: string[] = [];

    for (let g = 0; g < GAMES; g++) {
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
            if (boardRow[c]) {
              continue;
            }
            for (const color of COLORS) {
              const w = createsFourThree(board, r, c, color);
              const t = createsFourThreeTs(board, r, c, color);
              if (w !== t && mismatches.length < 20) {
                mismatches.push(
                  `g=${g} (${r},${c},${color}) wasm=${w} ts=${t}`,
                );
              }
            }
          }
        }
      }
    }

    expect(mismatches, mismatches.join("\n")).toEqual([]);
  }, 30000);
});
