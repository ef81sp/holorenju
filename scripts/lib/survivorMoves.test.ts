/**
 * findSurvivorMoves のテスト。
 * opening-book-2026-07-16.md §1 の生存手導出（run1帰属分析と同じ手法）を固定する。
 */
import { describe, expect, it } from "vitest";

import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import { createBoardFromRecord, parseMove } from "@/logic/gameRecordParser";

import { findSurvivorMoves } from "./survivorMoves";

const TEST_TIMEOUT = 60_000;

async function createEngine(): Promise<WasmSearchEngine> {
  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const wasm = await loadWasmModule();
  return new WasmSearchEngine(wasm);
}

describe("findSurvivorMoves", () => {
  it(
    "序盤局面（浅い・未決着）では代替手が候補上位から得られ、actualMove を除外する",
    async () => {
      const engine = await createEngine();
      // 黒1=天元・白2=I9・黒3=G11（3手、次は白4番）
      const { board, nextColor } = createBoardFromRecord("H8 I9 G11");
      expect(nextColor).toBe("white");

      // 実際に選ばれた手として I7（適当な白の一手）を actualMove とする
      const actualMove = parseMove("I7");
      const result = findSurvivorMoves(engine, board, "white", actualMove, 3);

      expect(result.candidatesChecked.length).toBeLessThanOrEqual(3);
      expect(result.candidatesChecked).not.toContain("I7");
      // 序盤の未決着局面なので、検証した代替手はすべて生存手のはず
      expect(result.survivors.length).toBe(result.candidatesChecked.length);
    },
    TEST_TIMEOUT,
  );

  it(
    "altCount で代替手の検証件数を制限できる",
    async () => {
      const engine = await createEngine();
      const { board } = createBoardFromRecord("H8 I9 G11");
      const actualMove = parseMove("I7");

      const result1 = findSurvivorMoves(engine, board, "white", actualMove, 1);
      expect(result1.candidatesChecked.length).toBeLessThanOrEqual(1);

      const result2 = findSurvivorMoves(engine, board, "white", actualMove, 2);
      expect(result2.candidatesChecked.length).toBeLessThanOrEqual(2);
    },
    TEST_TIMEOUT,
  );

  it(
    "戻り値の構造: candidatesChecked と survivors は共に文字列配列で、survivors は candidatesChecked の部分集合",
    async () => {
      const engine = await createEngine();
      const { board } = createBoardFromRecord("H8 I9 G11");
      const actualMove = parseMove("I7");
      const result = findSurvivorMoves(engine, board, "white", actualMove, 3);

      for (const s of result.survivors) {
        expect(result.candidatesChecked).toContain(s);
      }
    },
    TEST_TIMEOUT,
  );
});
