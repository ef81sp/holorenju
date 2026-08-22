/**
 * 「五」判定の TS⇄Zig パリティテスト（issue #125）
 *
 * 五の定義は TS (`renjuRules.checkFive` → `isFiveLength`) と
 * Zig (`forbidden.checkFive` → `forbidden.isFiveLength`) に二重実装されている。
 * #125 で白の長連（6 連以上）を五として扱うよう両方を揃えたので、その一致を
 * 1 ライン全列挙で機械的に確認する。
 *
 * 方式: 盤面の 1 ライン（長さ 9）に空/黒/白の全パターン 3^9 = 19,683 を敷き、
 * そのライン上の石すべてを「最後の着手」として TS 実装と wasm（Zig）を突き合わせる。
 * 他のマスは空なのでそのライン方向だけが効き、1 ラインの比較として閉じる。
 *
 * ラインは横（左端・右端で切れる 2 窓）・縦・斜め↘・斜め↗の 5 本を回す。
 * 斜めを含めることで TS `DIRECTION_PAIRS` ⇄ Zig `DIRECTION_PAIR_INDICES` の
 * 方向テーブルのズレも検出できる（横だけだと素通りしてしまう）。
 *
 * 3^9 列挙ハーネスは `search/fourDefenseParity.wasm.test.ts` と似た形だが、
 * あちらは threat.wasm・方向限定 API 用で同期手順（syncBitboard）も異なるため、
 * 共有ヘルパ化はせず各テストに閉じたまま置いている。
 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { loadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenLoader";
import { CELL } from "@/logic/cpu/wasm/types";

import { checkFive, createEmptyBoard } from "./index";

const wasm = await loadForbiddenWasm();

/** パターンを敷くマス数 */
const LINE_LEN = 9;

type PlayerColor = "black" | "white";

/** パターンを敷くライン（起点と方向）。9 マスが盤内に収まることを前提とする */
interface LineSpec {
  label: string;
  row: number;
  col: number;
  dr: number;
  dc: number;
}

const LINE_SPECS: LineSpec[] = [
  { label: "横（左端）", row: 7, col: 0, dr: 0, dc: 1 },
  { label: "横（右端）", row: 7, col: 6, dr: 0, dc: 1 },
  { label: "縦（上端）", row: 0, col: 7, dr: 1, dc: 0 },
  { label: "斜め↘", row: 2, col: 2, dr: 1, dc: 1 },
  { label: "斜め↗", row: 12, col: 2, dr: -1, dc: 1 },
];

const CELL_VALUES: (PlayerColor | null)[] = [null, "black", "white"];

function cellAt(spec: LineSpec, i: number): { row: number; col: number } {
  return { row: spec.row + spec.dr * i, col: spec.col + spec.dc * i };
}

function syncWasmLine(cells: (PlayerColor | null)[], spec: LineSpec): void {
  wasm.boardInit();
  for (let i = 0; i < LINE_LEN; i++) {
    const v = cells[i];
    if (!v) {
      continue;
    }
    const { row, col } = cellAt(spec, i);
    wasm.boardSet(row, col, v === "black" ? CELL.BLACK : CELL.WHITE);
  }
}

function buildBoard(cells: (PlayerColor | null)[], spec: LineSpec): BoardState {
  const board = createEmptyBoard();
  for (let i = 0; i < LINE_LEN; i++) {
    const v = cells[i];
    if (!v) {
      continue;
    }
    const { row, col } = cellAt(spec, i);
    board[row]![col] = v;
  }
  return board;
}

describe("checkFive の TS⇄Zig パリティ（#125）", () => {
  it("#125 実測例: 白 _WWWW_W のギャップを埋めると TS/Zig とも五", () => {
    const spec = LINE_SPECS[1]!;
    const cells: (PlayerColor | null)[] = new Array<PlayerColor | null>(
      LINE_LEN,
    ).fill(null);
    // index 0..3 白, 4 に着手, 5 白（= _WWWW_W 相当）
    for (const i of [0, 1, 2, 3, 4, 5]) {
      cells[i] = "white";
    }
    const board = buildBoard(cells, spec);
    syncWasmLine(cells, spec);

    const { row, col } = cellAt(spec, 4);
    expect(checkFive(board, row, col, "white")).toBe(true);
    expect(wasm.checkFiveWasm(row, col, CELL.WHITE)).toBe(1);
  });

  it("色コードが 1/2 以外（空点）なら wasm は常に 0 を返す", () => {
    wasm.boardInit();
    expect(wasm.checkFiveWasm(7, 7, 0)).toBe(0);
  });

  for (const spec of LINE_SPECS) {
    it(`1 ライン全列挙 3^${LINE_LEN} ${spec.label} で TS と wasm が完全一致`, () => {
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

        const board = buildBoard(cells, spec);
        syncWasmLine(cells, spec);

        for (let i = 0; i < LINE_LEN; i++) {
          const color = cells[i];
          if (!color) {
            continue;
          }
          const { row, col } = cellAt(spec, i);
          const cellCode = color === "black" ? CELL.BLACK : CELL.WHITE;
          const tsFive = checkFive(board, row, col, color);
          const zigFive = wasm.checkFiveWasm(row, col, cellCode) === 1;
          expect(zigFive, `code=${code} (${row},${col}) ${color}`).toBe(tsFive);
        }
      }
    });
  }
});
