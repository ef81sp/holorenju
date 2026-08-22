/**
 * 「五」判定の TS⇄Zig パリティテスト（issue #125）
 *
 * 五の定義は TS (`renjuRules.checkFive` → `isFiveLength`) と
 * Zig (`forbidden.checkFive` → `forbidden.isFiveLength`) に二重実装されている。
 * #125 で白の長連（6 連以上）を五として扱うよう両方を揃えたので、その一致を
 * 1 ライン全列挙で機械的に確認する。
 *
 * 方式: 盤面の 1 行（長さ 9）に空/黒/白の全パターン 3^9 = 19,683 を敷き、
 * そのライン上の自色石すべてを「最後の着手」として TS 実装と wasm（Zig）を
 * 突き合わせる。他の行は空なので横方向だけが効き、1 ラインの比較として閉じる。
 * 盤端で切れる長連も対象に含めるため、敷く開始列を 3 通り回す。
 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { loadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenLoader";
import { CELL } from "@/logic/cpu/wasm/types";

import { checkFive, createEmptyBoard } from "./index";

const wasm = await loadForbiddenWasm();

/** パターンを敷く行と列範囲 */
const LINE_ROW = 7;
const LINE_LEN = 9;
/** 盤端（左端・右端）と中央の 3 窓。盤外で切れる長連も比較対象に含める */
const LINE_STARTS = [0, 3, 6] as const;

type PlayerColor = "black" | "white";

const CELL_VALUES: (PlayerColor | null)[] = [null, "black", "white"];

function syncWasmLine(cells: (PlayerColor | null)[], lineStart: number): void {
  wasm.boardInit();
  for (let i = 0; i < LINE_LEN; i++) {
    const v = cells[i];
    if (v === "black") {
      wasm.boardSet(LINE_ROW, lineStart + i, CELL.BLACK);
    } else if (v === "white") {
      wasm.boardSet(LINE_ROW, lineStart + i, CELL.WHITE);
    }
  }
}

function buildBoard(
  cells: (PlayerColor | null)[],
  lineStart: number,
): BoardState {
  const board = createEmptyBoard();
  for (let i = 0; i < LINE_LEN; i++) {
    const v = cells[i];
    if (v) {
      board[LINE_ROW]![lineStart + i] = v;
    }
  }
  return board;
}

describe("checkFive の TS⇄Zig パリティ（#125）", () => {
  it("#125 実測例: 白 _WWWW_W のギャップを埋めると TS/Zig とも五", () => {
    const cells: (PlayerColor | null)[] = new Array<PlayerColor | null>(
      LINE_LEN,
    ).fill(null);
    // index 0..3 白, 4 に着手, 5 白（= _WWWW_W 相当）
    for (const i of [0, 1, 2, 3, 4, 5]) {
      cells[i] = "white";
    }
    const lineStart = 3;
    const board = buildBoard(cells, lineStart);
    syncWasmLine(cells, lineStart);

    expect(checkFive(board, LINE_ROW, lineStart + 4, "white")).toBe(true);
    expect(wasm.checkFiveWasm(LINE_ROW, lineStart + 4, CELL.WHITE)).toBe(1);
  });

  for (const lineStart of LINE_STARTS) {
    it(`1 ライン全列挙 3^${LINE_LEN} (start=${lineStart}) で TS と wasm が完全一致`, () => {
      const total = 3 ** LINE_LEN;
      const cells: (PlayerColor | null)[] = new Array<PlayerColor | null>(
        LINE_LEN,
      ).fill(null);

      for (let code = 0; code < total; code++) {
        let rest = code;
        for (let i = 0; i < LINE_LEN; i++) {
          cells[i] = CELL_VALUES[rest % 3] ?? null;
          rest = Math.floor(rest / 3);
        }

        const board = buildBoard(cells, lineStart);
        syncWasmLine(cells, lineStart);

        for (let i = 0; i < LINE_LEN; i++) {
          const color = cells[i];
          if (!color) {
            continue;
          }
          const col = lineStart + i;
          const cellCode = color === "black" ? CELL.BLACK : CELL.WHITE;
          const tsFive = checkFive(board, LINE_ROW, col, color);
          const zigFive = wasm.checkFiveWasm(LINE_ROW, col, cellCode) === 1;
          expect(zigFive, `code=${code} col=${col} ${color}`).toBe(tsFive);
        }
      }
    });
  }
});
