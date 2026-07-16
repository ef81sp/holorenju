/**
 * trapPipelineBlack.ts のテスト（opening-trap-mining-2026-07-16.md ★第2段、
 * 簡素化後: ルートは白版と同一の26珠型）。
 *
 * E2E アドミッション級テスト（issue blocker 反映方針を踏襲）: 白の攻め手が
 * 攻め側フィルタ（脅威プレフィルタ）を通る妥当なケースを最低1系統固定する。
 * 黒版の既知トラップはまだ無いため、白が26珠型のどれかから攻める合成ラインで
 * 代替する。
 */
import { describe, expect, it } from "vitest";

import type { Position } from "@/types/game";

import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import { createEmptyBoard } from "@/logic/renjuRules";

import { passesThreatPrefilter } from "./trapFilters";
import {
  buildBlackCheckTasks,
  type BlackBookDumpNode,
} from "./trapPipelineBlack";
import { buildJushuRoots } from "./trapRoutes";

const TEST_TIMEOUT = 120_000;

async function createEngine(): Promise<WasmSearchEngine> {
  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const wasm = await loadWasmModule();
  return new WasmSearchEngine(wasm);
}

// 1ルートのみ（雲月）に絞って軽量化（白版 trapPipeline.test.ts と同じ方針）
function singleRoute(): ReturnType<typeof buildJushuRoots> {
  const routes = buildJushuRoots();
  const route = routes.find((r) => r.name === "雲月");
  if (!route) {
    throw new Error("雲月ルートが見つかりません");
  }
  return [route];
}

describe("passesThreatPrefilter (white) — E2E アドミッション（go/no-go ゲート）", () => {
  it("白が26珠型(寒星)から攻める合成ラインで2方向の二を構成する手はフィルタを通る", () => {
    // 寒星: 黒1=天元(7,7)・白2=(8,7)・黒3=(9,7)
    // white4=(8,6): white2(8,7)と横隣接（1方向）
    // black5=(3,3): 適当な遠方の手（黒は一本道だが検証用に固定配置）
    // white6候補=(9,6): white4(8,6)と縦隣接（1方向）+ white2(8,7)と斜め隣接（1方向）＝2方向
    const board = createEmptyBoard();
    board[7]![7] = "black";
    board[8]![7] = "white";
    board[9]![7] = "black";
    board[8]![6] = "white";
    board[3]![3] = "black";
    const target: Position = { row: 9, col: 6 };
    expect(passesThreatPrefilter(board, target, "white")).toBe(true);
  });

  it("明白な非脅威手（孤立した遠方の手）は落ちる", () => {
    const board = createEmptyBoard();
    board[7]![7] = "black";
    board[8]![7] = "white";
    board[9]![7] = "black";
    board[8]![6] = "white";
    const farCorner: Position = { row: 0, col: 0 };
    expect(passesThreatPrefilter(board, farCorner, "white")).toBe(false);
  });
});

describe("buildBlackCheckTasks", () => {
  it(
    "1ルート・小予算で木を構築し、black5ノードがdumpBookSinkに記録される",
    async () => {
      const engine = await createEngine();
      const sink: BlackBookDumpNode[] = [];
      const tasks = buildBlackCheckTasks(engine, singleRoute(), {
        white4Budget: { maxTotal: 2 },
        white6Budget: { maxTotal: 2 },
        hardTimeMs: 1000,
        randomSeed: 1,
        dumpBookSink: sink,
      });

      expect(tasks.length).toBeGreaterThan(0);
      for (const task of tasks) {
        // moveStrs は6要素（白2,黒3,白4,黒5,白6。黒1は含まない）
        expect(task.moveStrs.length).toBe(6);
      }

      // black5ノードのみ記録される（black7はワーカー側で処理するため木構築時は未記録）
      const ply5Nodes = sink.filter((n) => n.ply === 5);
      expect(ply5Nodes.length).toBeGreaterThan(0);
      for (const node of sink) {
        expect(node.ply).toBe(5);
        expect(node.route).toBe("雲月");
        expect(typeof node.canonicalKey).toBe("string");
        expect(typeof node.blackMove).toBe("string");
        if (node.forcedWinKind === null) {
          expect(node.survivorMoves).toBeNull();
        } else {
          expect(Array.isArray(node.survivorMoves)).toBe(true);
        }
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "dumpBookSink 未指定時は従来どおり軽量（呼び出し条件の回帰確認）",
    async () => {
      const engine = await createEngine();
      const tasks = buildBlackCheckTasks(engine, singleRoute(), {
        white4Budget: { maxTotal: 1 },
        white6Budget: { maxTotal: 1 },
        hardTimeMs: 1000,
        randomSeed: 1,
      });
      expect(tasks.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );
});
