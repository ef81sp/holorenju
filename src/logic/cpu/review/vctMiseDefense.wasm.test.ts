/**
 * VCT 探索が「相手のミセ手（1手で四三を作れる手）」を再帰内で見落とす問題の回帰テスト
 *
 * 背景（GitHub issue #116「追い詰め手順で相手のミセ手を見逃している」）:
 * `findVCTSequence` のエントリ（zig/src/vct.zig）は探索開始局面について
 * 相手の活三・ミセ手・VCF を確認して VCF-only にフォールバックするが、
 * 再帰本体 `findVCTSequenceRecursive` と `hasVCT` は**活三しか見ていなかった**。
 * 受け手の分類 `checkDefenseCounterThreat` も「受け手自身が五/四/三を作るか」
 * しか見ないため、三を作らないミセ手（受けた結果として四三点が生じる手）は
 * `.none` 扱いで通常再帰に入り、攻撃側が四でない三を打つ手順が詰み木に載る。
 *
 * 実例（左下原点・黒先手）: 下記棋譜の17石局面で白の VCT が成立すると誤判定され、
 * メインライン 18.M5 19.L6 20.G8 21.J11 の分岐で白22が三（J5）になるが、
 * その時点で黒は四三点 J12 を持っており黒が先に勝つ（偽 VCT）。
 *
 * 修正: `hasVCT` / `findVCTSequenceRecursive` の各ノードでも
 * `hasFourThreeAvailable(opponent)` を確認し、成立していれば VCT 不成立とする
 * （直前で VCF を試しているため「四追いで勝てる」ケースは保存される）。
 */

import { describe, expect, it } from "vitest";

import type { BoardState, StoneColor } from "@/types/game";

import { createBoardFromRecord, parseMove } from "@/logic/gameRecordParser";

import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";
import { preloadThreatWasm } from "../wasm/threatAdapter";
import { detectForcedWin } from "./forcedWinDetection";

const RECORD =
  "H8 H9 J10 I9 G9 I7 I8 J8 H10 K9 L10 K7 K10 I10 J9 H7 J7 I6 G8 F8 L11 M12 L9 L12 J11 I12 J12 J13 I11 K13 K11";

const engine = new WasmSearchEngine(await loadWasmModule());
await preloadThreatWasm();

function play(board: BoardState, move: string, color: StoneColor): void {
  const { row, col } = parseMove(move);
  board[row]![col] = color;
}

describe("VCT: 相手のミセ手を持つ局面では三の追いで勝ちと判定しない（issue #116）", () => {
  it("17石局面（白18手目の直前）で白の forcedWinType が vct にならない", () => {
    const { board } = createBoardFromRecord(RECORD, 17);
    const result = detectForcedWin(board, "white", false, false, engine);
    expect(result.forcedWinType).not.toBe("vct");
  }, 120_000);

  it("偽 VCT 手順の分岐 18.M5 19.L6 20.G8 21.J11 の後、白に VCT はない", () => {
    const { board } = createBoardFromRecord(RECORD, 17);
    play(board, "M5", "white");
    play(board, "L6", "black");
    play(board, "G8", "white");
    play(board, "J11", "black");

    const result = detectForcedWin(board, "white", false, false, engine);
    expect(result.forcedWinType).not.toBe("vct");
  }, 120_000);
});
