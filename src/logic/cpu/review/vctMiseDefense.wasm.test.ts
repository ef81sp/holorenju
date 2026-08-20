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
 * 修正: 各ノードで `opponentBlocksThreePursuit`（相手の活三 or ミセ手）を確認し、
 * 真なら**三の攻め手だけ**を打ち切る（四で受けを強制して相手の脅威を潰してから
 * 三で追う真正 VCT は保存される）。
 *
 * 期待値の根拠: 17石局面を Rapfi オラクル（30s/手）にかけると best = J11・
 * eval +5、つまりこの局面に白の強制勝ちは無い。よって forcedWinType は
 * undefined（vct 以外の型でもない）でなければならない。
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";
import { preloadThreatWasm } from "../wasm/threatAdapter";
import { detectForcedWin } from "./forcedWinDetection";

/** 実戦棋譜。先頭17手が問題の局面（白18手目 I6 の直前） */
const RECORD =
  "H8 H9 J10 I9 G9 I7 I8 J8 H10 K9 L10 K7 K10 I10 J9 H7 J7 I6 G8 F8 L11 M12 L9 L12 J11 I12 J12 J13 I11 K13 K11";

/** 上記17手 + 偽 VCT 手順の分岐 18.白M5 19.黒L6 20.白G8 21.黒J11（手番は自動交代） */
const RECORD_FALSE_VCT_BRANCH = `${RECORD.split(" ").slice(0, 17).join(" ")} M5 L6 G8 J11`;

const engine = new WasmSearchEngine(await loadWasmModule());
await preloadThreatWasm();

describe("VCT: 相手のミセ手を持つ局面では三の追いで勝ちと判定しない（issue #116）", () => {
  it("17石局面（白18手目の直前）に白の強制勝ちは無い", () => {
    const { board } = createBoardFromRecord(RECORD, 17);
    const result = detectForcedWin(board, "white", false, false, engine);
    expect(result.forcedWinType).toBeUndefined();
    expect(result.forcedWin).toBeNull();
  }, 120_000);

  it("偽 VCT 手順の分岐 18.M5 19.L6 20.G8 21.J11 の後も白の強制勝ちは無い", () => {
    // 開始局面と分岐の整合ガード（Zig 単体テストの WASM 経路版）。
    // この分岐単体は修正前から緑（findVCTSequence のエントリのガードで即棄却・3ms）。
    // 「同じ局面を新規探索すると VCT が出ないのに、木の途中では VCT 扱いになる」
    // という非対称が再発したら、1本目と合わせてここで検出できる。
    const { board } = createBoardFromRecord(RECORD_FALSE_VCT_BRANCH);
    const result = detectForcedWin(board, "white", false, false, engine);
    expect(result.forcedWinType).toBeUndefined();
    expect(result.forcedWin).toBeNull();
  }, 120_000);
});
