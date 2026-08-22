/**
 * ct=four のブロック石が五連になる VCT を取りこぼす偽陰性の回帰テスト（issue #140）
 *
 * `zig/src/vct.zig` の ct=four 処理は、受け手のカウンター四を攻撃側がブロックしたあと
 * `block_ct == .win`（＝ブロック石が五連を作った＝その場で勝ち）でも即勝ちにせず、
 * `getThreatDefensePositions` の結果に判断を委ねていた。五連と同時に別方向の四/活三が
 * できていると `.positions` が返るため受けごとの探索に入り、真の勝ちを取りこぼしていた。
 *
 * 判別力のある単体テストは Zig 側（`zig/src/vct.zig` の issue #140 テスト）にある。
 * ここでは live 経路（振り返りの `findVCTByFirstMoveIteration` → wasm）で同じ局面が
 * VCT として返ることを固定する。
 */

import { describe, expect, it } from "vitest";

import { parseInitialBoard } from "@/logic/boardParser";

import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";

/**
 * issue #140 の再現局面（黒番・攻めは黒）
 *
 * - 黒 (7,7) は「列7の止め四（受けは (8,7) 一点）＋ 行7の活三（受けに (7,8) を含む）」。
 * - 白が (7,8) で活三を受けると、同時に斜め (4,11)(5,10)(6,9)(7,8) のカウンター四になる
 *   （黒 (3,12) が上端を止めているので五点は (8,7) 一点）。
 * - 黒がそれを (8,7) でブロックすると、その石が列7を (4,7)〜(8,7) の**五連**にする＝勝ち。
 *   ところが同じ石が斜め (7,6)(8,7)(9,8) の活三も作るため、修正前は受けの列挙に入って
 *   「VCT 不成立」と判定していた。
 * - 白の (5,9)(6,8)(8,6) は、黒が (8,7) から四で追い始めるのを止めるための細工
 *   （黒 (8,7) の四に白が (7,7) で受けるとカウンター四になる＝黒に根の VCF は無い）。
 */
const BOARD_140 = [
  "---------------",
  "---------------",
  "---------------",
  "-------o----x--",
  "-------x--xo---",
  "-------x-oo----",
  "-------xoo-----",
  "-----xx--------",
  "------o--------",
  "--------x------",
  "---------------",
  "---------------",
  "---------------",
  "---------------",
  "---------------",
];

const engine = new WasmSearchEngine(await loadWasmModule());

describe("VCT: ブロック石が五連になる勝ちを取りこぼさない（issue #140）", () => {
  it("findVCTSequence が (7,7) からの VCT を返す", () => {
    const board = parseInitialBoard(BOARD_140);
    const result = engine.findVCTSequence(board, "black", 5, 0, 0, false);
    expect(result).not.toBeNull();
    expect(result?.firstMove).toEqual({ row: 7, col: 7 });
  }, 30_000);

  // 五連で終わる手順なので深度 2（攻め + 受け + 継続）で足りる。
  // 修正前は五連の勝ちを取りこぼし、その埋め合わせに深い探索が必要だった。
  it("findVCTSequenceFromFirstMove が (7,7) を VCT 初手として認める", () => {
    const board = parseInitialBoard(BOARD_140);
    const result = engine.findVCTSequenceFromFirstMove(
      board,
      { row: 7, col: 7 },
      "black",
      2,
      0,
      0,
      false,
    );
    expect(result).not.toBeNull();
    expect(result?.firstMove).toEqual({ row: 7, col: 7 });
  }, 30_000);
});
