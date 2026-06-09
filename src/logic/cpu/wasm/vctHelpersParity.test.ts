/**
 * vctHelpers 3関数の Zig⇄TS パリティ（#37 P3 PR6）
 *
 * hasOpenThree / hasFourThreeAvailable / findThreatMoves を Zig 単一ソース化するにあたり、
 * WASM 委譲版（threatAdapter）と TS 実装（vctHelpers）が合法局面で完全一致することを保証する。
 *
 * createsFourThreeParity.test.ts と同じ方針: 全空き点総当たりの非合法盤は未定義領域で分岐するため、
 * **決定的なランダム合法自己対局**（黒の禁手を尊重・五で終局・近傍着手）で生成した全局面・両色を照合する。
 *
 * - hasOpenThree / hasFourThreeAvailable: 各局面・両色で bool 一致
 * - findThreatMoves: 各局面・両色で **順序付き配列**（row-major・four優先）まで一致
 *   （TS・Zig とも同一走査順なので、順序差が出れば実バグとして検出する）
 */
import { describe, expect, it } from "vitest";

import type { BoardState, Position, StoneColor } from "@/types/game";

import {
  findThreatMoves as findThreatMovesTs,
  hasFourThreeAvailable as hasFourThreeAvailableTs,
  hasOpenThree as hasOpenThreeTs,
} from "@/logic/cpu/search/vctHelpers";
import { checkFive, createEmptyBoard } from "@/logic/renjuRules/core";
import { checkForbiddenMove } from "@/logic/renjuRules/forbiddenMoves";

import {
  findThreatMoves,
  hasFourThreeAvailable,
  hasOpenThree,
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

/** Position[] を順序保持で文字列化（findThreatMoves の厳密比較用） */
function serialize(positions: Position[]): string {
  return positions.map((p) => `${p.row},${p.col}`).join("|");
}

await preloadThreatWasm();

describe("vctHelpers parity (#37 P3 PR6)", () => {
  it("ランダム合法自己対局の全局面・両色で Zig==TS", () => {
    const COLORS: StoneColor[] = ["black", "white"];
    const GAMES = 80;
    let seed = 0xc0ffee01;
    const mismatches: string[] = [];

    for (let g = 0; g < GAMES; g++) {
      const rng = mulberry32(seed);
      seed = (seed + 0x9e3779b1) | 0;
      const snaps = playRandomLegalGame(rng, 50);

      for (const board of snaps) {
        for (const color of COLORS) {
          // hasOpenThree
          const wOpen = hasOpenThree(board, color);
          const tOpen = hasOpenThreeTs(board, color);
          if (wOpen !== tOpen && mismatches.length < 20) {
            mismatches.push(
              `g=${g} hasOpenThree(${color}) wasm=${wOpen} ts=${tOpen}`,
            );
          }

          // hasFourThreeAvailable
          const wFt = hasFourThreeAvailable(board, color);
          const tFt = hasFourThreeAvailableTs(board, color);
          if (wFt !== tFt && mismatches.length < 20) {
            mismatches.push(
              `g=${g} hasFourThreeAvailable(${color}) wasm=${wFt} ts=${tFt}`,
            );
          }

          // findThreatMoves（順序込み）
          const wMoves = serialize(findThreatMoves(board, color));
          const tMoves = serialize(findThreatMovesTs(board, color));
          if (wMoves !== tMoves && mismatches.length < 20) {
            mismatches.push(
              `g=${g} findThreatMoves(${color}) wasm=[${wMoves}] ts=[${tMoves}]`,
            );
          }
        }
      }
    }

    expect(mismatches, mismatches.join("\n")).toEqual([]);
  }, 30000);
});
