/**
 * issue #115 の全木検査（14 石の根から）
 *
 * unit プロジェクトから外した理由: この局面の `detectForcedWin` は修正後
 * 約 34 秒かかり（受け点が是正されて探索木が広がったため。修正前は約 6.4 秒）、
 * pre-commit の `pnpm test` に載せるには重すぎる。
 * 軽量版（20 石の分岐局面）は `vctOverlineDefense.wasm.test.ts` にあり、
 * issue #115 の不整合自体はそちらでも赤になる。
 *
 * 実行方法: `pnpm test:perf`（vitest の perf プロジェクト。testTimeout 既定 120 秒）
 *
 * 検査内容と不変条件の意味は `forcedWinTreeTestUtils.ts` の docstring を参照。
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";
import { preloadThreatWasm } from "../wasm/threatAdapter";
import { detectForcedWin } from "./forcedWinDetection";
import { collectForcedWinTreeViolations } from "./forcedWinTreeTestUtils";

/** 実戦棋譜。先頭 14 手が問題の局面（黒 15 手目の直前） */
const RECORD =
  "H8 H7 G8 G9 I10 H9 J9 J10 K8 H11 L9 K9 I11 I9 I12 K10 L10 L8 K11 I13 L11 M10 M9 N8 J12 L12 H12 G12 F9 F8 G7 F11 H13 I8 G10 E7 D6 D8 F6 G6 F5 E5 E8 C7 G4 D7 B7 C8 C9 D9 E10 D11 D10 C10 B9 G11 E11 E9 F10 B6 A5 F12 E13 J8";

const engine = new WasmSearchEngine(await loadWasmModule());
await preloadThreatWasm();

describe("VCT: 14 石局面の詰み木全体に長連前提の強制受けが現れない（issue #115）", () => {
  it("全経路の攻め手ノードで受けの数と脅威の強さが釣り合う", () => {
    const { board } = createBoardFromRecord(RECORD, 14);
    const result = detectForcedWin(board, "black", false, false, engine);

    // 手順や forcedWinType は固定しない（この局面の VCT 自体、白のカウンターフォーで
    // 崩れる疑いが別途ある。それを正しく消す将来の修正で赤くならないようにする）。
    const violations = collectForcedWinTreeViolations(
      result.forcedWin?.tree,
      board,
      "black",
      15,
    );
    expect(violations).toEqual([]);
  });
});
