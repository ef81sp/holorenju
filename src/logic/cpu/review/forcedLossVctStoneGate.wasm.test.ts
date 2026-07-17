/**
 * #70: review の VCT 石数ゲート（VCT_STONE_THRESHOLD）バグの回帰テスト
 *
 * 背景: ボス実戦棋譜 "H8 I9 I8 G8 H7 G6 I7 J6 G7 J7 H6 H9 G5 F4 H4 H5 E7 F7 F6 I3 D8"
 * の8手目 J6（白）は、黒に11手の strict VCT（G7 J7 H6 H5 F8 I5 H10 H9 E7 F7 G9）
 * がある敗着だが、review はこれを excellent（forcedLossType なし）と誤判定して
 * 見逃していた。
 *
 * 原因: checkForcedLoss（forcedLossCheck.ts）自体には石数ゲートが無く、
 * VCT探索そのものは J6 の局面（8石）でも 600ms 未満で正しく検出できていた
 * （forcedLossStrictVCT.wasm.test.ts の白J7・9手目ケースで既に実証済み）。
 * 実際に検出を妨げていたのは review.worker.ts の vctCheckOnly 分岐に
 * インラインされていた `stoneCountAfter >= VCT_STONE_THRESHOLD`（旧値14）
 * ゲートで、J6 の8石はこれを満たさず VCT 探索自体が一度も実行されなかった。
 *
 * 修正: 石数ゲート判定を checkForcedLossVCTOnly（review.worker.ts とテストの
 * 両方が使う SSoT）に切り出してテスト可能にし、VCT_STONE_THRESHOLD を
 * 14→4 に引き下げた（開局3手=OPENING_MOVESは review のキューに載らないため、
 * 4は実質「開局直後を除く全ての手でVCTチェックする」に等しい）。
 * レイテンシ対策として FORCED_LOSS_VCT_OPTIONS.timeLimit も 10,000ms→3,000ms
 * に短縮（詳細はそちらのコメント参照）。
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import { countStones } from "../core/boardUtils";
import { VCT_STONE_THRESHOLD } from "../search/types";
import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";
import { preloadThreatWasm } from "../wasm/threatAdapter";
import {
  checkForcedLossVCTOnly,
  FORCED_LOSS_VCT_OPTIONS,
} from "./forcedLossCheck";

const engine = new WasmSearchEngine(await loadWasmModule());
await preloadThreatWasm();

// ボス実戦棋譜。8手目 J6（白、0-indexed moveIndex=7）が本件の敗着。
const RECORD_UP_TO_J6 = "H8 I9 I8 G8 H7 G6 I7 J6";

describe("checkForcedLossVCTOnly: VCT石数ゲート（#70）", () => {
  it("J6局面（8石）は現行の VCT_STONE_THRESHOLD 以上である（回帰ガード）", () => {
    // 旧値14ではこの局面はゲートで弾かれ、VCT探索自体が実行されなかった。
    // 閾値は将来また調整され得るため、8石が閾値未満に戻っていないことを固定する。
    expect(VCT_STONE_THRESHOLD).toBeLessThanOrEqual(8);
  });

  it("J6局面（8石）でVCTが正しく検出される（実際の review 予算・skipStoneThresholdなし）", () => {
    const { board } = createBoardFromRecord(RECORD_UP_TO_J6);
    const stoneCount = countStones(board);
    expect(stoneCount).toBe(8);

    const result = checkForcedLossVCTOnly(
      board,
      "white", // J6を打った側（自分）
      "black", // 被詰みを検証する相手
      stoneCount,
      engine,
      { vctOptions: FORCED_LOSS_VCT_OPTIONS },
    );

    expect(result?.type).toBe("vct");
  });

  it("旧閾値相当（14）を明示すると J6局面はゲートで弾かれる（バグ時の挙動を再現）", () => {
    const { board } = createBoardFromRecord(RECORD_UP_TO_J6);

    // checkForcedLossVCTOnly 自体は VCT_STONE_THRESHOLD 定数を直接使うため、
    // 旧バグの挙動は stoneCountAfter が定数を下回るケースとして
    // 石数を人為的に小さく渡すことでシミュレートする。
    const result = checkForcedLossVCTOnly(
      board,
      "white",
      "black",
      3, // 旧14は当然、現行閾値(4)未満に相当する値
      engine,
      { vctOptions: FORCED_LOSS_VCT_OPTIONS },
    );

    expect(result).toBeUndefined();
  });

  it("skipStoneThreshold=true なら石数に関わらずVCTチェックが実行される（Phase 3遡及用）", () => {
    const { board } = createBoardFromRecord(RECORD_UP_TO_J6);

    const result = checkForcedLossVCTOnly(
      board,
      "white",
      "black",
      0, // 極端に低い石数でもスキップ指定があれば検出できる
      engine,
      { vctOptions: FORCED_LOSS_VCT_OPTIONS, skipStoneThreshold: true },
    );

    expect(result?.type).toBe("vct");
  });

  it("自分（color）に活四があればVCT不成立として即 undefined を返す（selfHasFourガード）", () => {
    // 白が横に4連続の活四(open four、B8-E8、両端A8/F8が空)を作った人工局面。
    // 黒の石(A1,C3,E5,G7)は互いに孤立しており脅威なし。石数は閾値を満たすが、
    // 白は次に五連確定のため黒のVCTは検証するまでもなく不成立。
    const { board } = createBoardFromRecord("A1 B8 C3 C8 E5 D8 G7 E8");
    const stoneCount = countStones(board);

    const result = checkForcedLossVCTOnly(
      board,
      "white", // 白(B8,C8,D8,E8)が横の活四を持つ
      "black",
      stoneCount,
      engine,
      { vctOptions: FORCED_LOSS_VCT_OPTIONS },
    );

    expect(result).toBeUndefined();
  });
});
