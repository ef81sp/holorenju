/**
 * VCT 探索のノード予算が実際に効くことの回帰テスト（issue #119）
 *
 * #119 以前の `zig/src/vct.zig` は `incrementNodes` を一切呼んでおらず、
 * `limiter.nodes` を進めるのは共有 limiter を渡した `vcf.zig` だけだった。
 * そのため `forcedWinDetection.ts` のフォールバック `findVCTByFirstMoveIteration`
 * が渡す `maxNodes: VCT_FALLBACK_MAX_NODES`（100k）は事実上「無制限」で、
 * 1 局面の `detectForcedWin` が数十秒に伸びる原因になっていた。
 *
 * ここではフォールバックが使うのと同じ wasm 入口
 * （`findVCTSequenceFromFirstMove` = `wasmFindVCTSequenceFromFirstMove` の実体）
 * について、ノード上限を小さくすると探索が打ち切られることを固定する。
 * 判別力のある単体テストは Zig 側（`zig/src/vct.zig` の issue #119 テスト）にある。
 */

import { describe, expect, it } from "vitest";

import { parseInitialBoard } from "@/logic/boardParser";

import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";

/**
 * 白（攻め）の VCT 局面
 *
 * 行7 は黒 (7,2) が端を止めた白 3 連 (7,3)(7,4)(7,5)。白 (7,6) が四で
 * 受けは (7,7) の一点。以後は白の三の追いで詰む（手順長 5）。
 * 黒は活三もミセ手も VCF も持たないので `findVCTSequenceFromFirstMove` の
 * 入口ガードは通り、探索本体まで到達する。
 * 数ノードぶんの展開が要るので、ノード上限 1 では到達できない。
 */
const BOARD_VCT = [
  "---------------",
  "---------------",
  "---------------",
  "---------------",
  "---------------",
  "---------------",
  "---------------",
  "--xooo---------",
  "---------------",
  "---------------",
  "------oo-------",
  "--------o------",
  "--------o------",
  "---------------",
  "---------------",
];

const FIRST_MOVE = { row: 7, col: 6 };

const engine = new WasmSearchEngine(await loadWasmModule());

describe("VCT: maxNodes が探索を打ち切る（issue #119）", () => {
  it("ノード無制限なら初手指定の VCT 手順が見つかる", () => {
    const board = parseInitialBoard(BOARD_VCT);
    const result = engine.findVCTSequenceFromFirstMove(
      board,
      FIRST_MOVE,
      "white",
      5,
      0,
      0,
      false,
    );
    expect(result).not.toBeNull();
  }, 30_000);

  it("ノード上限 1 では打ち切られて見つからない（#119 以前はノーオペで見つかっていた）", () => {
    const board = parseInitialBoard(BOARD_VCT);
    const result = engine.findVCTSequenceFromFirstMove(
      board,
      FIRST_MOVE,
      "white",
      5,
      0,
      1,
      false,
    );
    expect(result).toBeNull();
  }, 30_000);
});
