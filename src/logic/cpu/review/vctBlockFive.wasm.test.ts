/**
 * ct=four のブロック石が五連になる VCT を取りこぼす偽陰性の回帰テスト（issue #140）
 *
 * `zig/src/vct.zig` の ct=four 処理は、受け手のカウンター四を攻撃側がブロックしたあと
 * `block_ct == .win`（＝ブロック石が五連を作った＝その場で勝ち）でも即勝ちにせず、
 * `getThreatDefensePositions` の結果に判断を委ねていた。五連と同時に別方向の四/活三が
 * できていると `.positions` が返るため受けごとの探索に入り、真の勝ちを取りこぼしていた。
 *
 * Zig 側（`zig/src/vct.zig` の issue #140 テスト）に加えて、live 経路（振り返りの
 * `findVCTByFirstMoveIteration` → wasm）でも判別テストとして固定する。
 * **本ファイルの 2 本は修正前はいずれも赤**。
 */

import { describe, expect, it } from "vitest";

import { parseInitialBoard } from "@/logic/boardParser";

import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";
import { BOARD_ISSUE_140 } from "./vctBlockFiveFixture";

const engine = new WasmSearchEngine(await loadWasmModule());

/** 回帰時に探索が上限まで走らないよう時間制限を付ける（正常時は数 ms で返る） */
const TIME_LIMIT_MS = 5000;

describe("VCT: ブロック石が五連になる勝ちを取りこぼさない（issue #140）", () => {
  it("findVCTSequence が (7,7) からの VCT を返す", () => {
    const board = parseInitialBoard(BOARD_ISSUE_140);
    const result = engine.findVCTSequence(
      board,
      "black",
      5,
      TIME_LIMIT_MS,
      0,
      false,
    );
    expect(result).not.toBeNull();
    expect(result?.firstMove).toEqual({ row: 7, col: 7 });
  }, 30_000);

  // 五連で終わる手順なので深度 2（攻め + 受け + 継続）で足りる。
  // 修正前は五連の勝ちを取りこぼし、その埋め合わせに深い探索が必要だった。
  it("findVCTSequenceFromFirstMove が (7,7) を VCT 初手として認める", () => {
    const board = parseInitialBoard(BOARD_ISSUE_140);
    const result = engine.findVCTSequenceFromFirstMove(
      board,
      { row: 7, col: 7 },
      "black",
      2,
      TIME_LIMIT_MS,
      0,
      false,
    );
    expect(result).not.toBeNull();
    expect(result?.firstMove).toEqual({ row: 7, col: 7 });
  }, 30_000);
});
