/**
 * VCT 探索が「長連にしかならない跳び四」を本物の四として扱う問題の回帰テスト（軽量版）
 *
 * 背景（GitHub issue #115「長連を含む追い詰めを提案される」）:
 * 黒の跳び四は、ギャップを埋めると 6 連（長連）になる場合は五にできないので四ではない。
 * `classifyThreat` / `checkDefenseCounterThreat` / `createsFour` は
 * `isJumpFourOverline` で補正していたが、受け点を返す
 * `getThreatDefensePositions`（zig/src/vct.zig）の跳び四ブランチだけ補正が無かった。
 * その結果、三でしかない攻め手に対して「跳び四のギャップ 1 点」だけが受けとして
 * 列挙され、受け側の正当な他の受けが探索木から消えて偽の追い詰めが成立していた。
 *
 * 実例（左下原点・黒先手）: 実戦 14 手のあと偽手順 15.L7 16.M6 17.L8 18.L6 19.J7
 * 20.M10 を進めた 20 石局面（黒番）で、黒 J8 の 8 行目は G8 H8 _ J8 K8 L8。
 * ギャップ I8 は黒が打つと長連なので J8 は四ではない（`classifyThreat` も
 * four=false / three=true と返す）のに、受けだけ I8 の 1 点強制になっていた。
 *
 * このファイルは **20 石の分岐局面**（Zig 単体テストの `setupIssue115BranchPosition`
 * と同じ局面）を使う軽量版で、unit プロジェクトに置く。
 * 14 石の根からの全木検査は実行に 30 秒以上かかるため
 * `vctOverlineDefense.perf.test.ts` に分けてある。
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";
import { preloadThreatWasm } from "../wasm/threatAdapter";
import { detectForcedWin } from "./forcedWinDetection";
import { collectForcedWinTreeViolations } from "./forcedWinTreeTestUtils";

/** 実戦 14 手 + 偽 VCT 手順の先頭 15.L7 16.M6 17.L8 18.L6 19.J7 20.M10（黒番） */
const BRANCH_RECORD =
  "H8 H7 G8 G9 I10 H9 J9 J10 K8 H11 L9 K9 I11 I9 L7 M6 L8 L6 J7 M10";

const engine = new WasmSearchEngine(await loadWasmModule());
await preloadThreatWasm();

describe("VCT: 長連にしかならない跳び四で受けを1点に絞らない（issue #115）", () => {
  it("20 石の分岐局面（黒番）の詰み木に長連前提の強制受けが現れない", () => {
    const { board } = createBoardFromRecord(BRANCH_RECORD);
    const result = detectForcedWin(board, "black", false, false, engine);

    // 追い詰めの有無そのものは固定しない。
    // この局面に黒の VCT があるかは探索の別の性質（カウンターフォー耐性の
    // 厳格度など）にも左右されるので、「VCT が返るならその木は整合している」
    // という条件付きの主張にする（VCT が返らなければ検査対象なしで通る）。
    const violations = collectForcedWinTreeViolations(
      result.forcedWin?.tree,
      board,
      "black",
      21,
    );
    expect(violations).toEqual([]);
  }, 120_000);
});
