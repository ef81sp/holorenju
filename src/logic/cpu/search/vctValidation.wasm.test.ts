/**
 * `blockThreatContinues` / `opponentBlocksThreePursuit` の回帰テスト（issue #117 / #118）
 *
 * カウンター四をブロックした石が三しか作らないとき、受け手には受ける義務がない。
 * 受け手が活三/ミセ手/VCF を持つなら、その三では追えない（＝VCT 手順は崩壊する）。
 * Zig 側 `vct.zig` の同名関数と同じ意味論（二重実装）。
 */

import { beforeAll, describe, expect, it } from "vitest";

import { parseInitialBoard } from "@/logic/boardParser";

import { BOARD_ISSUE_140 } from "../review/vctBlockFiveFixture";
import {
  hasFourThreeAvailable,
  hasOpenThree,
  preloadThreatWasm,
} from "../wasm/threatAdapter";
import { checkDefenseCounterThreat } from "./threatPatterns";
import {
  blockThreatContinues,
  opponentBlocksThreePursuit,
  validateVCTSequence,
} from "./vctValidation";

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

/**
 * issue #118 の再現局面（受けは白）。白は活三もミセ手も持たないが (1,4) が四四で VCF を持つ。
 * Zig 探索側はノード深さ <= 1 でしか VCF を見ないが、本検証は線形リプレイなので
 * 深さゲート無しで全局面の相手 VCF まで見る。
 */
const BOARD_OPPONENT_VCF_ONLY = [
  "---------------",
  "xooo-----------",
  "----o----------",
  "----o----------",
  "----o----------",
  "----x----------",
  "---------------",
  "-------xx------",
  "-----x-----x---",
  "----x-------x--",
  "---------------",
  "---------------",
  "---------------",
  "---------------",
  "---------------",
];

describe("opponentBlocksThreePursuit（issue #116 / #118）", () => {
  it("相手が活三もミセ手も持たなくても VCF を持つなら三では追えない", () => {
    const board = parseInitialBoard(BOARD_OPPONENT_VCF_ONLY);
    expect(hasOpenThree(board, "white")).toBe(false);
    expect(hasFourThreeAvailable(board, "white")).toBe(false);
    expect(opponentBlocksThreePursuit(board, "white")).toBe(true);
  });

  it("相手に活三・ミセ手・VCF のいずれも無ければ三で追える", () => {
    const board = parseInitialBoard(BOARD_AFTER_BLOCK_NO_THREE);
    expect(opponentBlocksThreePursuit(board, "black")).toBe(false);
  });
});

/**
 * issue #140: 黒 (7,7)（列7の止め四 + 行7の活三）→ 白 (7,8)（活三の受け兼カウンター四）
 * → 黒 (8,7)（カウンター四のブロック。同時に列7の五連＝その場で勝ち）。
 *
 * 注: このテストに判別力は無い（修正前も緑）。修正前もループが末尾に達して有効を返すため。
 * 「五連の後ろを検証し続けない」という意味論の固定用で、判別テストは Zig 側と
 * `review/vctBlockFive.wasm.test.ts` にある。
 */
describe("validateVCTSequence: ブロック石が五連なら手順はそこで確定（issue #140）", () => {
  it("五連になるブロックで終わる手順は有効", () => {
    const board = parseInitialBoard(BOARD_ISSUE_140);
    const sequence = [
      { row: 7, col: 7 },
      { row: 7, col: 8 },
      { row: 8, col: 7 },
    ];
    expect(validateVCTSequence(board, "black", sequence)).toBe(true);
  });
});
