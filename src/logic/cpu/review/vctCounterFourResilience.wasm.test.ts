/**
 * 白のカウンターフォーを挟んでも黒の追い詰めが残ることの回帰テスト（issue #123）
 *
 * 背景:
 * #115 の棋譜 `H8 H7 G8 G9 I10 H9 J9 J10 K8 H11 L9 K9 I11 I9`（14 石・黒番）から
 * 振り返りが返す追い詰めの 21 手目 `M8` は四ではなく三なので、白は受けを強制されず
 * カウンターフォー（9 行目 `E9 _ G9 H9 I9` の E9 / 6 行目 `I6 _ K6 L6 M6` の K6）で
 * テンポを取れる。この「テンポ喪失だけのカウンターフォー」を `ResilienceMode.lenient`
 * が棄却しないのは偽の追い詰めではないか、という疑義が #123。
 *
 * Rapfi（Renju ルール、mix9svqrenju 重み）で検証した結果、疑義は否定された:
 * - 14 石の根: best=J7 / Eval **+M17**
 * - 21 石局面（M8 後・白番）: **-M24**（白がどう指しても詰み）
 * - +E9: 黒 +M23 → +E9 F9: 白 -M22 → +E9 F9 N8: 黒 +M11
 * - +K6: 黒 +M23 → +K6 J6: 白 -M22 → +K6 J6 N8: 黒 +M11
 * - +E9 F9 K6 J6 N8（両方のカウンターフォーを消化）: 黒 +M9
 * カウンターフォーは白のテンポを稼ぐだけで、黒の追い詰めは消えない。
 *
 * このテストは「カウンターフォーを消化した後の各分岐でも黒に強制勝ちが残る」ことと
 * 「白の四が盤上にある間は追い詰めを主張しない（受けが先）」ことを固定する。
 */

import { describe, expect, it } from "vitest";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";
import {
  detectOpponentThreats,
  preloadThreatWasm,
} from "../wasm/threatAdapter";
import { detectForcedWin } from "./forcedWinDetection";

/** 実戦 14 手 + 追い詰め 15..21 手目（21 石・白番） */
const AFTER_M8 =
  "H8 H7 G8 G9 I10 H9 J9 J10 K8 H11 L9 K9 I11 I9 L7 M6 J7 I6 L8 L6 M8";

const engine = new WasmSearchEngine(await loadWasmModule());
await preloadThreatWasm();

function hasFour(record: string, color: "black" | "white"): boolean {
  const { board } = createBoardFromRecord(record);
  const threats = detectOpponentThreats(board, color);
  return threats.fours.length > 0 || threats.openFours.length > 0;
}

describe("VCT: 白のカウンターフォーを挟んでも追い詰めが残る（issue #123）", () => {
  it.each([
    ["白 E9 の四を消化した後", `${AFTER_M8} E9 F9 N8`],
    ["白 K6 の四を消化した後", `${AFTER_M8} K6 J6 N8`],
    ["白が E9・K6 両方の四を消化した後", `${AFTER_M8} E9 F9 K6 J6 N8`],
  ])(
    "%s も黒に強制勝ちが残る",
    (_name, record) => {
      const { board, nextColor } = createBoardFromRecord(record);
      expect(nextColor).toBe("black");
      expect(hasFour(record, "white")).toBe(false);

      const result = detectForcedWin(board, "black", false, false, engine);
      expect(result.forcedWin).not.toBeNull();
    },
    60_000,
  );

  it("白の四が盤上にある間は追い詰めを主張せず受けを促す", () => {
    const record = `${AFTER_M8} E9`;
    const { board, nextColor } = createBoardFromRecord(record);
    expect(nextColor).toBe("black");
    // 白 E9 で 9 行目が E9 _ G9 H9 I9 となり F9 が五点（四）。
    expect(hasFour(record, "white")).toBe(true);

    const result = detectForcedWin(board, "black", true, false, engine);
    expect(result.forcedWin).toBeNull();
    expect(result.forcedWinType).toBeUndefined();
  }, 60_000);
});
