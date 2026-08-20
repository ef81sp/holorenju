/**
 * 受け点（四を止める点）の TS⇄Zig パリティテスト（issue #115 / #124）
 *
 * 連珠ルールは TS と Zig に二重実装されている。issue #115 で受け点の基準を
 * `collectLineFivePoints` に統一したので、その基準が両実装で一致していることを
 * 1 ライン全列挙で機械的に確認する。
 *
 * 方式: 盤面の 1 行（row 7 の col 3..11、長さ 9）に空/黒/白の全パターン 3^9 = 19,683 を
 * 敷き、各パターン・各色・そのライン上の自色石すべてを「最後の着手」として
 *
 * - `collectLineFivePoints`（横方向）
 * - `getFourDefensePosition`
 *
 * を TS 実装と wasm（Zig）で突き合わせる。他の行は空なので横方向だけが効き、
 * 1 ラインの比較として閉じる。
 */

import { describe, expect, it } from "vitest";

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import { createEmptyBoard } from "@/logic/renjuRules";

import { collectLineFivePoints } from "../core/lineAnalysis";
import { getThreatWasm, preloadThreatWasm } from "../wasm/threatLoader";
import { CELL } from "../wasm/types";
import { getFourDefensePosition } from "./threatPatterns";

await preloadThreatWasm();

/** パターンを敷く行と列範囲 */
const LINE_ROW = 7;
const LINE_START = 3;
const LINE_LEN = 9;
/** 横方向（DIRECTIONS[0]）。TS/Zig で並び一致を確認済み */
const DIR_INDEX = 0;
/** getFourDefensePositionWasm が「受けなし（null）」を表す番兵 */
const NO_DEFENSE = 255;

type PlayerColor = "black" | "white";

const CELL_VALUES: (PlayerColor | null)[] = [null, "black", "white"];

function syncWasmLine(cells: (PlayerColor | null)[]): void {
  const wasm = getThreatWasm();
  wasm.boardInit();
  for (let i = 0; i < LINE_LEN; i++) {
    const v = cells[i];
    if (v === "black") {
      wasm.boardSet(LINE_ROW, LINE_START + i, CELL.BLACK);
    } else if (v === "white") {
      wasm.boardSet(LINE_ROW, LINE_START + i, CELL.WHITE);
    }
  }
  wasm.syncBitboard();
}

function readFivePointsFromWasm(
  row: number,
  col: number,
  color: PlayerColor,
): Position[] {
  const wasm = getThreatWasm();
  wasm.collectLineFivePointsWasm(
    row,
    col,
    DIR_INDEX,
    color === "black" ? CELL.BLACK : CELL.WHITE,
  );
  const offset = wasm.getFivePointsBuffer();
  const bytes = new Uint8Array(wasm.memory.buffer, offset);
  const count = bytes[0] ?? 0;
  const points: Position[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      row: bytes[1 + i * 2] ?? 0,
      col: bytes[2 + i * 2] ?? 0,
    });
  }
  return points;
}

function fourDefenseFromWasm(
  row: number,
  col: number,
  color: PlayerColor,
): Position | null {
  const wasm = getThreatWasm();
  const encoded = wasm.getFourDefensePositionWasm(
    row,
    col,
    color === "black" ? CELL.BLACK : CELL.WHITE,
  );
  if (encoded === NO_DEFENSE) {
    return null;
  }
  return {
    row: Math.floor(encoded / BOARD_SIZE),
    col: encoded % BOARD_SIZE,
  };
}

function buildBoard(cells: (PlayerColor | null)[]): BoardState {
  const board = createEmptyBoard();
  const boardRow = board[LINE_ROW];
  for (let i = 0; i < LINE_LEN; i++) {
    if (boardRow) {
      boardRow[LINE_START + i] = cells[i] ?? null;
    }
  }
  return board;
}

/** 比較しやすいように "r,c" の配列へ */
function key(points: Position[]): string[] {
  return points.map((p) => `${p.row},${p.col}`).sort();
}

describe("受け点の TS⇄Zig パリティ（1ライン全列挙・issue #115）", () => {
  it("collectLineFivePoints と getFourDefensePosition が全パターンで一致する", () => {
    const total = 3 ** LINE_LEN;
    const cells: (PlayerColor | null)[] = new Array<PlayerColor | null>(
      LINE_LEN,
    ).fill(null);

    const mismatches: string[] = [];
    let comparisons = 0;

    for (let code = 0; code < total; code++) {
      let rest = code;
      for (let i = 0; i < LINE_LEN; i++) {
        cells[i] = CELL_VALUES[rest % 3] ?? null;
        rest = Math.floor(rest / 3);
      }

      const board = buildBoard(cells);
      syncWasmLine(cells);

      for (const color of ["black", "white"] as const) {
        for (let i = 0; i < LINE_LEN; i++) {
          if (cells[i] !== color) {
            continue;
          }
          const col = LINE_START + i;
          comparisons++;

          const tsFive = key(
            collectLineFivePoints(board, LINE_ROW, col, 0, 1, color),
          );
          const zigFive = key(readFivePointsFromWasm(LINE_ROW, col, color));
          if (tsFive.join("|") !== zigFive.join("|")) {
            mismatches.push(
              `collectLineFivePoints code=${code} color=${color} col=${col}: ts=[${tsFive.join(" ")}] zig=[${zigFive.join(" ")}]`,
            );
          }

          const tsDefense = getFourDefensePosition(
            board,
            { row: LINE_ROW, col },
            color,
          );
          const zigDefense = fourDefenseFromWasm(LINE_ROW, col, color);
          const tsKey = tsDefense
            ? `${tsDefense.row},${tsDefense.col}`
            : "null";
          const zigKey = zigDefense
            ? `${zigDefense.row},${zigDefense.col}`
            : "null";
          if (tsKey !== zigKey) {
            mismatches.push(
              `getFourDefensePosition code=${code} color=${color} col=${col}: ts=${tsKey} zig=${zigKey}`,
            );
          }
        }
      }
    }

    // 比較が実際に行われていること（ループ条件のミスで 0 件になる事故を防ぐ）
    expect(comparisons).toBeGreaterThan(10_000);
    expect(mismatches.slice(0, 10)).toEqual([]);
  }, 120_000);
});
