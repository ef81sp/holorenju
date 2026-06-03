/**
 * Zig→TS 詰み木ワイヤ往復の実 WASM 統合テスト（#22）
 *
 * main.zig writeForcedWinTree のバイト出力を searchEngine（readSequenceWithTree）
 * が正しく ForcedWinNode へ復元できるか（フォーマット整合）を実 WASM で検証する。
 *
 * VCT の collect 探索は重い（depth でしか制限されない）ため、ノード制限で
 * 高速かつ同一バイト形式を通る Mise-VCF 経路（#18 局面）で往復を検証する。
 */

import { describe, expect, it } from "vitest";

import type { ForcedWinNode, ForcedWinDefense } from "@/types/review";

import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";

import { loadWasmModule } from "./loader";
import { WasmSearchEngine } from "./searchEngine";

/** node から defenses[0] 連鎖を攻め始まり交互で平坦化 */
function spine(node: ForcedWinNode): string[] {
  const out: string[] = [];
  let cur: ForcedWinNode | undefined = node;
  while (cur) {
    out.push(formatMove(cur.attackerMove));
    const [d0]: (ForcedWinDefense | undefined)[] = cur.defenses;
    if (!d0) {
      break;
    }
    out.push(formatMove(d0.defenderMove));
    cur = d0.next;
  }
  return out;
}

describe("詰み木ワイヤ往復 (Mise-VCF #18 局面)", () => {
  it("木を復元でき、defenses[0]連鎖がsequenceに一致し代替三防御を分岐に持つ", async () => {
    const engine = new WasmSearchEngine(await loadWasmModule());
    // #18 棋譜の43手目まで（44手目=白番、最善 G6 ミセ手）
    const { board, nextColor } = createBoardFromRecord(
      "H8 H9 I9 I8 G7 F6 G10 G9 F9 H11 H7 F7 F10 G8 I10 H10 K11 J10 " +
        "F8 K9 I11 I13 H6 E9 F11 F12 I5 J4 G5 H5 I7 J8 J6 J7 K7 L8 " +
        "F4 E3 G3 H4 I6 K6 L5",
    );
    expect(nextColor).toBe("white");

    const res = engine.findMiseVCFSequence(board, nextColor, 0, 5000, true);
    expect(res).not.toBeNull();
    const { tree } = res!;
    expect(tree).toBeTruthy();

    // ルート攻め手 = ミセ手 G6
    expect(formatMove(tree!.attackerMove)).toBe("G6");
    // defenses[0] 連鎖 == sequence（バイト往復の整合）
    expect(spine(tree!)).toEqual(res!.sequence.map(formatMove));
    // 主筋防御は I4
    expect(formatMove(tree!.defenses[0]!.defenderMove)).toBe("I4");
    // 代替三防御 E8 が root の分岐(defenses[1..])に存在
    const altDefenders = tree!.defenses
      .slice(1)
      .map((d) => formatMove(d.defenderMove));
    expect(altDefenders).toContain("E8");
  });
});
