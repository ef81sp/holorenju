/**
 * ct=four のブロック点が黒の禁手のとき偽 VCT を主張する回帰テスト（issue #146）
 *
 * `zig/src/vct.zig` の ct=four 処理は、受け手のカウンター四をブロックする点を
 * `quiescence.getFourDefensePosition` で求めてそのまま置石しており、攻め側が黒のときに
 * その点が禁手（三三 / 四四）でないかを確認していなかった（受け手の防御点 `dp` 側は
 * 以前から `forbidden.checkForbiddenMove` を見ていた＝非対称）。
 * 実戦では打てない点にブロックする手順を「成立した VCT」として返しうる。
 *
 * Zig 側（`zig/src/vct.zig` の issue #146 テスト）に加えて、live 経路（振り返りの
 * `findVCTByFirstMoveIteration` → wasm）でも判別テストとして固定する。
 * **本ファイルの 2 本は修正前はいずれも赤**（1 本目は当初「VCT なし」を要求していたが、
 * 反復深化の早期打ち切り修正で別初手の本物の追い詰めが見つかるようになり期待値を更新した）。
 */

import { describe, expect, it } from "vitest";

import { parseInitialBoard } from "@/logic/boardParser";

import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";
import { BOARD_ISSUE_146 } from "./vctBlockForbiddenFixture";

const engine = new WasmSearchEngine(await loadWasmModule());

/** 回帰時に探索が上限まで走らないよう時間制限を付ける（正常時は数 ms で返る） */
const TIME_LIMIT_MS = 5000;

describe("VCT: ブロック点が黒の禁手なら偽 VCT を主張しない（issue #146）", () => {
  it("findVCTSequence が (7,8) を初手とする偽 VCT を返さない", () => {
    // この局面には (7,8) 以外の初手（(4,10) の活三 → (7,9) で白のカウンター四点を
    // 埋めつつ四 → 四 → 活四）による本物の追い詰めがある。旧実装は最初に見つかった
    // (7,8) 手順を事後の耐性検証で棄却すると反復深化ごと打ち切っていたため
    // 「なし」になっていたが、主張してはならないのは「初手 (7,8)」であって
    // 「追い詰めなし」ではない（Zig 側 issue #146 テストと同じ期待値）。
    const board = parseInitialBoard(BOARD_ISSUE_146);
    const result = engine.findVCTSequence(
      board,
      "black",
      5,
      TIME_LIMIT_MS,
      0,
      false,
    );
    expect(result).not.toBeNull();
    expect(result?.sequence[0]).not.toEqual({ row: 7, col: 8 });
  }, 30_000);

  it("findVCTSequenceFromFirstMove が (7,8) を VCT 初手として認めない", () => {
    const board = parseInitialBoard(BOARD_ISSUE_146);
    const result = engine.findVCTSequenceFromFirstMove(
      board,
      { row: 7, col: 8 },
      "black",
      5,
      TIME_LIMIT_MS,
      0,
      false,
    );
    expect(result).toBeNull();
  }, 30_000);
});
