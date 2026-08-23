/**
 * VCT 探索が「受け手側の反撃手段」を確認していない問題の回帰テスト（issue #117 / #118）
 *
 * - #117: `evaluateCounterThreat` の ct=four 分岐で、攻撃側がカウンター四をブロックした石が
 *   三しか作らない（block_ct = three）とき、受け手には受ける義務がないのに受け点だけを
 *   列挙して続行していた。受け手が活三/ミセ手を持つならその三は間に合わない。
 * - #118: 再帰本体（`findVCTSequenceRecursive` / `hasVCT`）は #116 修正後も相手の
 *   活三・ミセ手までしか見ておらず、相手の VCF（四追いの強制勝ち）を確認していなかった。
 *
 * 判別力のある単体テストは Zig 側（`zig/src/vct.zig` の issue #117 / #118 テスト）にある。
 * `hasVCT` / 再帰本体は wasm に露出していないため、ここでは wasm 経由で到達できる
 * `findVCTSequence` について「これらの局面で VCT を返さない」ことを固定する
 * （エントリのガードで棄却されるため修正前から緑。wasm 配線と意味論の回帰検出用）。
 */

import { describe, expect, it } from "vitest";

import { parseInitialBoard } from "@/logic/boardParser";

import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";

/**
 * issue #117 の再現局面（白番・攻めは白）
 *
 * 白 (3,7) が四（受けは (3,8) 一点）→ 黒 (3,8) がカウンター四（受けは (3,12) 一点）
 * → 白 (3,12) のブロックは縦と斜めの活三を作るだけ（四ではない）。
 * その局面で黒は行10の活三を持つため、黒は白の三を無視して達四を作れる＝VCT 不成立。
 */
const BOARD_117 = [
  "---------------",
  "---------------",
  "---------------",
  "---xooo--xxx---",
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

/**
 * issue #118 の再現局面（黒番・攻めは黒、受けの白が VCF を持つ）
 *
 * 黒は (7,9) の活三から四三で勝てる「三の追い」を持つが、
 * 白は (1,4) が四四になる VCF を持つため、黒の三は必ず先に潰される＝VCT 不成立。
 * 白に活三もミセ手もないので、#116 のガード（活三 or ミセ手）では検出できない。
 */
const BOARD_118 = [
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

const engine = new WasmSearchEngine(await loadWasmModule());

describe("VCT: 受け手の反撃手段を見落とさない（issue #117 / #118）", () => {
  it("ct=four のブロックが三しか作らず相手に活三がある局面で VCT を返さない（#117）", () => {
    const board = parseInitialBoard(BOARD_117);
    const result = engine.findVCTSequence(board, "white", 5, 0, 0, false);
    expect(result).toBeNull();
  }, 30_000);

  it("相手が VCF を持つ局面で三の追いを VCT として返さない（#118）", () => {
    const board = parseInitialBoard(BOARD_118);
    const result = engine.findVCTSequence(board, "black", 5, 0, 0, false);
    expect(result).toBeNull();
  }, 30_000);
});
