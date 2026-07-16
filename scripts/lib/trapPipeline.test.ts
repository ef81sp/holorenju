/**
 * trapPipeline.ts の dumpBookSink 対応テスト（opening-book-2026-07-16.md §1）。
 * white4/white6 ノードで dumpBookSink 指定時のみ強制勝ちチェック・生存手導出が
 * 呼ばれる「呼び出し条件」を固定する。重い実測は避け、1ルート・小予算のみで検証する。
 */
import { describe, expect, it } from "vitest";

import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";

import { buildCheckTasks, type BookDumpNode } from "./trapPipeline";
import { buildJushuRoots } from "./trapRoutes";

const TEST_TIMEOUT = 120_000;

async function createEngine(): Promise<WasmSearchEngine> {
  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const wasm = await loadWasmModule();
  return new WasmSearchEngine(wasm);
}

// 1ルートのみ（雲月）に絞って軽量化
function singleRoute(): ReturnType<typeof buildJushuRoots> {
  const routes = buildJushuRoots();
  const route = routes.find((r) => r.name === "雲月");
  if (!route) {
    throw new Error("雲月ルートが見つかりません");
  }
  return [route];
}

describe("buildCheckTasks dumpBookSink", () => {
  it(
    "dumpBookSink 未指定時は従来どおり軽量（呼び出し条件の回帰確認）",
    async () => {
      const engine = await createEngine();
      const tasks = buildCheckTasks(engine, singleRoute(), {
        black5Budget: { maxTotal: 1 },
        black7Budget: { maxTotal: 1 },
        hardTimeMs: 1000,
        randomSeed: 1,
      });
      expect(tasks.length).toBeGreaterThan(0);
      for (const task of tasks) {
        expect(task.moveStrs.length).toBe(7);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "dumpBookSink 指定時、white4/white6 ノードが記録される",
    async () => {
      const engine = await createEngine();
      const sink: BookDumpNode[] = [];
      const tasks = buildCheckTasks(engine, singleRoute(), {
        black5Budget: { maxTotal: 1 },
        black7Budget: { maxTotal: 1 },
        hardTimeMs: 1000,
        randomSeed: 1,
        dumpBookSink: sink,
      });

      expect(tasks.length).toBeGreaterThan(0);
      // 1ルート × (white4 1件 + black5候補数分の white6)
      const white4Nodes = sink.filter((n) => n.ply === 4);
      const white6Nodes = sink.filter((n) => n.ply === 6);
      expect(white4Nodes.length).toBe(1);
      expect(white6Nodes.length).toBeGreaterThanOrEqual(1);

      for (const node of sink) {
        expect(node.route).toBe("雲月");
        expect(typeof node.canonicalKey).toBe("string");
        expect(node.canonicalKey.length).toBeGreaterThan(0);
        expect(typeof node.hardMove).toBe("string");
        // 強制勝ちなしなら survivorMoves は null（トラップ時のみ算出）
        if (node.forcedWinKind === null) {
          expect(node.survivorMoves).toBeNull();
        } else {
          expect(Array.isArray(node.survivorMoves)).toBe(true);
        }
      }

      // white4 ノードの movesUpToHere はルート3手のみ
      expect(white4Nodes[0]!.movesUpToHere.length).toBe(3);
      // white6 ノードの movesUpToHere はルート3手+white4+black5=5手
      expect(white6Nodes[0]!.movesUpToHere.length).toBe(5);
    },
    TEST_TIMEOUT,
  );
});
