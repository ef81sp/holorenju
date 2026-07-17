/**
 * checkForcedLoss の VCT strict 化（幻の被詰み対策）の回帰テスト
 *
 * 背景（review-threshold-calibration 2026-07-17 較正調査）:
 * checkForcedLoss（被追詰=相手の forcedWin 判定）は `findVCTSequenceWasm` を
 * 呼んでいたが、この WASM export は「振り返り用エントリは攻めの追い詰め
 * 手順提示」という前提で `.lenient` にハードコードされていた。lenient は
 * カウンターフォーでテンポを奪い返される手順（幻の被詰み）を棄却しないため、
 * 被追詰の判定に使うと過剰検出（scoreDiff に関係なく quality=blunder に
 * 強制降格）を起こす。較正データ(n=186)では forcedLossType=vct の9件中7件が
 * この経路の偽陽性だった（vcf/forbidden-trap 等は無関係。zig/src/vct.zig の
 * ResilienceMode ドキュメント参照）。
 *
 * 修正: 被詰み判定専用の `findVCTSequenceStrictWasm`（.strict）を新設し、
 * checkForcedLoss（forcedLossCheck.ts）と review.worker.ts の vctCheckOnly
 * パスをこちらに切り替えた。自分の forcedWin 検出（攻め、lenient のまま）
 * には影響しない。
 *
 * 「本物の被詰みは維持される」ことは reviewSnapshot.test.ts の
 * checkForcedLoss: white29-m20 スナップショット（type=vct、修正前後で
 * バイト同一）が既に検証済み。本ファイルは「幻の被詰みは解除される」側の
 * 直接的な回帰テストを補う。
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import { countStones } from "../core/boardUtils";
import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";
import { preloadThreatWasm } from "../wasm/threatAdapter";
import {
  checkForcedLoss,
  FORCED_LOSS_VCT_OPTIONS,
  REVIEW_MISE_VCF_OPTIONS,
  REVIEW_VCF_OPTIONS,
  type ForcedLossCheckOptions,
} from "./forcedLossCheck";

// 決定的設定: timeLimit を Infinity にして node/maxDepth のみで打ち切る
// （reviewSnapshot.test.ts の DETERMINISTIC_LOSS_OPTIONS と同じ方針）
const DETERMINISTIC_LOSS_OPTIONS: ForcedLossCheckOptions = {
  vcfOptions: { ...REVIEW_VCF_OPTIONS, timeLimit: Infinity },
  miseVcfOptions: { ...REVIEW_MISE_VCF_OPTIONS, timeLimit: Infinity },
  vctOptions: { ...FORCED_LOSS_VCT_OPTIONS, timeLimit: Infinity },
};

// WASM は1回だけロードして全テストで使い回す（reviewSnapshot.test.ts と同じ方針）
const engine = new WasmSearchEngine(await loadWasmModule());
await preloadThreatWasm();

describe("checkForcedLoss VCT strict化（幻の被詰み対策）", () => {
  it("本物の被詰み（実戦棋譜の白J7・9手目）は strict化後も forcedLossType=vct を維持", () => {
    // ボス実戦棋譜 "H8 I9 I8 G8 H7 G6 I7 J6 G7 J7"（白J7=10手中の10手目、0-indexed moveIndex9）
    const record = "H8 I9 I8 G8 H7 G6 I7 J6 G7 J7";
    const { board } = createBoardFromRecord(record);
    const stoneCount = countStones(board);
    const result = checkForcedLoss(
      board,
      "black",
      stoneCount,
      engine,
      DETERMINISTIC_LOSS_OPTIONS,
    );
    expect(result?.type).toBe("vct");
  });

  it("幻の被詰み（commit-bench#224局面の白H7・17手目相当）は strict化で forcedLossType が解除される", () => {
    // 較正データ(n=186)で確認された偽陽性実例。修正前は type=vct で検出されていたが、
    // strict（カウンターフォー耐性検証）では手順が崩壊し検出されなくなる。
    const record = "H8 I9 F6 I7 I6 H9 H6 G6 J9 I8 J7 I10 I11 J8 H5 K8 H4 H7";
    const { board } = createBoardFromRecord(record);
    const stoneCount = countStones(board);
    const result = checkForcedLoss(
      board,
      "black",
      stoneCount,
      engine,
      DETERMINISTIC_LOSS_OPTIONS,
    );
    expect(result).toBeUndefined();
  });
});
