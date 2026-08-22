/**
 * `blockThreatContinues` の回帰テスト（issue #117）
 *
 * カウンター四をブロックした石が三しか作らないとき、受け手には受ける義務がない。
 * 受け手が活三/ミセ手を持つなら、その三では追えない（＝VCT 手順は崩壊する）。
 * Zig 側 `vct.zig` の同名関数と同じ意味論（二重実装）。
 */

import { beforeAll, describe, expect, it } from "vitest";

import { parseInitialBoard } from "@/logic/boardParser";

import { preloadThreatWasm } from "../wasm/threatAdapter";
import { checkDefenseCounterThreat } from "./threatPatterns";
import { blockThreatContinues } from "./vctValidation";

/**
 * issue #117 の再現局面のブロック直後（白 (3,7) 四 → 黒 (3,8) カウンター四 → 白 (3,12) ブロック）
 *
 * 白 (3,12) は縦（列12）と斜めの活三を作るだけで四ではない。
 * 黒は行10に活三を持つため、黒は白の三を無視して達四を作れる。
 */
const BOARD_AFTER_BLOCK = [
  "---------------",
  "---------------",
  "---------------",
  "---xooooxxxxo--",
  "-----------oo--",
  "----------o-o--",
  "---------------",
  "---------------",
  "---------------",
  "---------------",
  "----xxx--------",
  "---------------",
  "---------------",
  "---------------",
  "---------------",
];

/** 上と同じだが黒の活三（行10）が無い局面 */
const BOARD_AFTER_BLOCK_NO_THREE = BOARD_AFTER_BLOCK.map((line, row) =>
  row === 10 ? "---------------" : line,
);

beforeAll(async () => {
  await preloadThreatWasm();
});

describe("blockThreatContinues（issue #117）", () => {
  it("ブロック石が三しか作らず受け手が活三を持つ場合は継続不可", () => {
    const board = parseInitialBoard(BOARD_AFTER_BLOCK);
    const blockThreat = checkDefenseCounterThreat(board, 3, 12, "white");
    expect(blockThreat).toBe("three");
    expect(blockThreatContinues(blockThreat, board, "black")).toBe(false);
  });

  it("受け手に活三/ミセ手が無ければ三のブロックでも継続可", () => {
    const board = parseInitialBoard(BOARD_AFTER_BLOCK_NO_THREE);
    const blockThreat = checkDefenseCounterThreat(board, 3, 12, "white");
    expect(blockThreat).toBe("three");
    expect(blockThreatContinues(blockThreat, board, "black")).toBe(true);
  });

  it("ブロック石が四なら受けは強制なので追加チェック不要（受け手の活三と無関係に継続可）", () => {
    const board = parseInitialBoard(BOARD_AFTER_BLOCK);
    expect(blockThreatContinues("four", board, "black")).toBe(true);
    expect(blockThreatContinues("win", board, "black")).toBe(true);
  });

  it("ブロック石が脅威を作らなければ継続不可", () => {
    const board = parseInitialBoard(BOARD_AFTER_BLOCK);
    expect(blockThreatContinues("none", board, "black")).toBe(false);
  });
});
