#!/usr/bin/env node
/**
 * 序盤トラップ採掘パイプライン CLI（opening-trap-mining-2026-07-16.md）。
 *
 * ルート集合（26珠型 + 珠型外ルート）ごとに hard 白4 → 攻め側フィルタで黒5候補
 * → hard 白6 → 攻め側フィルタで黒7候補 → hard 白8 + 黒の強制勝ち判定（VCF∪VCT）を
 * 進め、severity-A（実機再検証ゲート通過）のトラップ候補を JSONL に出力する。
 *
 * 使用例（スモーク・軽予算）:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/trap-mining.ts --roots=雲月 --b5=2 --b7=2 --jobs=2 --hard-time=1000
 *
 *   # キャリブレーションモード（代表 ply-7 局面 N 点の1チェック平均時間を実測のみ）
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/trap-mining.ts --calibrate=30
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";

import type { CheckTask, CheckTaskResult } from "./trap-mining-worker";

import { canonicalKey } from "./lib/boardSymmetry";
import { checkForcedWin } from "./lib/forcedWinCheck";
import { buildCheckTasks, type CheckLineTask } from "./lib/trapPipeline";
import { buildAllRoots } from "./lib/trapRoutes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// CLI 引数
// ============================================================================

interface CliOptions {
  rootsFilter: string | null;
  b5: number;
  b7: number;
  jobs: number;
  out: string | null;
  calibrate: number | null;
  hardTimeMs: number | undefined;
  /** 攻め側フィルタのランダム枠抽選シード（固定すれば決定的）。 */
  randomSeed: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    rootsFilter: null,
    b5: 12,
    b7: 20,
    jobs: 6,
    out: null,
    calibrate: null,
    hardTimeMs: undefined,
    randomSeed: 20260716,
  };
  for (const arg of args) {
    if (arg.startsWith("--roots=")) {
      opts.rootsFilter = arg.slice("--roots=".length);
    } else if (arg.startsWith("--b5=")) {
      opts.b5 = parseInt(arg.slice("--b5=".length), 10);
    } else if (arg.startsWith("--b7=")) {
      opts.b7 = parseInt(arg.slice("--b7=".length), 10);
    } else if (arg.startsWith("--jobs=")) {
      opts.jobs = parseInt(arg.slice("--jobs=".length), 10);
    } else if (arg.startsWith("--out=")) {
      opts.out = arg.slice("--out=".length);
    } else if (arg.startsWith("--calibrate=")) {
      opts.calibrate = parseInt(arg.slice("--calibrate=".length), 10);
    } else if (arg.startsWith("--hard-time=")) {
      opts.hardTimeMs = parseInt(arg.slice("--hard-time=".length), 10);
    } else if (arg.startsWith("--seed=")) {
      opts.randomSeed = parseInt(arg.slice("--seed=".length), 10);
    }
  }
  return opts;
}

// ============================================================================
// チェック粒度ワーカープール（gate3 方式の直接 wasm ロード・ワークスティール）
// ============================================================================

function createCheckWorker(): Promise<Worker> {
  const workerPath = path.join(__dirname, "trap-mining-worker.ts");
  const loaderPath = path.join(__dirname, "register-loader.mjs");
  return new Promise<Worker>((resolve, reject) => {
    const worker = new Worker(workerPath, {
      execArgv: [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "--import",
        loaderPath,
      ],
    });

    const initTimeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("trap-mining-worker の初期化がタイムアウトしました"));
    }, 60000);

    const readyHandler = (msg: unknown): void => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        "ready" in msg &&
        (msg as { ready: unknown }).ready === true
      ) {
        clearTimeout(initTimeout);
        worker.off("message", readyHandler);
        resolve(worker);
      }
    };
    worker.on("message", readyHandler);
    worker.on("error", (err) => {
      clearTimeout(initTimeout);
      reject(err);
    });
  });
}

/**
 * チェック粒度のワークスティール並列実行（match.ts の nextTask カウンタ方式を踏襲）。
 */
async function runCheckTasksInParallel(
  tasks: CheckLineTask[],
  jobs: number,
  hardTimeMs: number | undefined,
): Promise<Map<number, CheckTaskResult>> {
  const workerCount = Math.max(1, Math.min(jobs, tasks.length || 1));
  const workers = await Promise.all(
    Array.from({ length: workerCount }, () => createCheckWorker()),
  );

  const results = new Map<number, CheckTaskResult>();
  let nextTask = 0;

  const runWorker = (worker: Worker): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const sendNext = (): void => {
        if (nextTask >= tasks.length) {
          worker.off("message", messageHandler);
          resolve();
          return;
        }
        const task = tasks[nextTask]!;
        nextTask += 1;
        const req: CheckTask = {
          taskId: task.taskId,
          boardAfterBlack7: task.boardAfterBlack7,
          hardTimeMs,
        };
        worker.postMessage(req);
      };
      const messageHandler = (msg: CheckTaskResult): void => {
        results.set(msg.taskId, msg);
        sendNext();
      };
      worker.on("message", messageHandler);
      worker.on("error", reject);
      sendNext();
    });

  await Promise.all(workers.map((w) => runWorker(w)));
  for (const worker of workers) {
    worker.postMessage({ type: "shutdown" });
    await worker.terminate();
  }

  return results;
}

// ============================================================================
// 出力レコード
// ============================================================================

interface TrapMiningRecord {
  canonicalKeyPly8: string;
  route: string;
  /** [黒1, 白2, 黒3, 白4, 黒5, 白6, 黒7] */
  moves: string[];
  black5Provenance: CheckLineTask["black5Provenance"];
  black7Provenance: CheckLineTask["black7Provenance"];
  severity: "A";
  forcedWinKind: "VCF" | "VCT";
  forcedWinSequence: string;
  hardTimeMsUsed: number | null;
  verifiedAtFullHardTime: boolean;
}

// ============================================================================
// メイン
// ============================================================================

async function main(): Promise<void> {
  const opts = parseArgs();

  const allRoutes = buildAllRoots();
  const routes = opts.rootsFilter
    ? allRoutes.filter((r) => r.name.includes(opts.rootsFilter!))
    : allRoutes;

  console.log("========================================");
  console.log(" 序盤トラップ採掘パイプライン");
  console.log("========================================");
  console.log(`ルート数: ${routes.length}（全体: ${allRoutes.length}）`);
  console.log(`b5=${opts.b5} b7=${opts.b7} jobs=${opts.jobs}`);
  const hardTimeSuffix =
    opts.hardTimeMs === undefined ? "" : "ms（実機再検証ゲートあり）";
  console.log(
    `hard-time: ${opts.hardTimeMs ?? "実機default"}${hardTimeSuffix}`,
  );

  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const wasm = await loadWasmModule();
  const mainEngine = new WasmSearchEngine(wasm);

  console.log("");
  console.log("Phase 1/2: white4/white6 + 攻め側フィルタ候補選定（直列）...");
  const tasks = buildCheckTasks(mainEngine, routes, {
    black5Budget: { maxTotal: opts.b5 },
    black7Budget: { maxTotal: opts.b7 },
    hardTimeMs: opts.hardTimeMs,
    randomSeed: opts.randomSeed,
  });
  console.log(`チェックタスク数: ${tasks.length}`);

  if (opts.calibrate !== null) {
    const sampleSize = Math.min(opts.calibrate, tasks.length);
    const sample = tasks.slice(0, sampleSize);
    console.log("");
    console.log(
      `キャリブレーションモード: 代表 ${sampleSize} 点の1チェック（hard白8+VCF+VCT）平均時間を実測...`,
    );
    const elapsedList: number[] = [];
    for (const task of sample) {
      const result = checkForcedWin(
        mainEngine,
        task.boardAfterBlack7,
        "white",
        opts.hardTimeMs,
      );
      elapsedList.push(result.elapsedMs);
    }
    const avg = elapsedList.reduce((a, b) => a + b, 0) / elapsedList.length;
    console.log(
      `平均: ${(avg / 1000).toFixed(2)}秒/チェック（${sampleSize}点）`,
    );
    console.log(
      "（キャリブレーションのみ。本チェック・JSONL出力は実行していません）",
    );
    return;
  }

  console.log("");
  console.log(
    `Phase 3: チェック粒度ワークスティール並列（jobs=${opts.jobs}）...`,
  );
  const results = await runCheckTasksInParallel(
    tasks,
    opts.jobs,
    opts.hardTimeMs,
  );

  const outPath =
    opts.out ?? path.join("bench-results", `trap-mining-${Date.now()}.jsonl`);
  mkdirSync(path.dirname(outPath), { recursive: true });

  let forcedWinCount = 0;
  const records: TrapMiningRecord[] = [];
  for (const task of tasks) {
    const result = results.get(task.taskId);
    if (!result || result.forcedWinKind === null) {
      continue;
    }
    forcedWinCount++;
    if (!result.verifiedAtFullHardTime) {
      // 実機再検証ゲート未通過 = severity-A 未確定。閾値カウントに含めない（§4, §6）。
      continue;
    }

    records.push({
      canonicalKeyPly8: canonicalKey(task.boardAfterBlack7, "white"),
      route: task.route.name,
      moves: [...task.moveStrs],
      black5Provenance: task.black5Provenance,
      black7Provenance: task.black7Provenance,
      severity: "A",
      forcedWinKind: result.forcedWinKind,
      forcedWinSequence: result.forcedWinSequenceStr ?? "",
      hardTimeMsUsed: opts.hardTimeMs ?? null,
      verifiedAtFullHardTime: result.verifiedAtFullHardTime,
    });
  }

  const lines = records.map((r) => JSON.stringify(r));
  writeFileSync(outPath, lines.length > 0 ? `${lines.join("\n")}\n` : "");

  // §6 の閾値判定は「canonical ply-8前局面」= distinct(canonicalKeyPly8) で数える。
  // レコード数（重複局面を含む）とは別に集計する。
  const distinctPositionCount = new Set(records.map((r) => r.canonicalKeyPly8))
    .size;

  console.log("");
  console.log("========================================");
  console.log(
    ` 結果: severity-A ${distinctPositionCount}局面（${records.length}レコード）を ${outPath} に出力`,
  );
  console.log(
    `（総チェック数: ${tasks.length}, 強制勝ちあり(ゲート前): ${forcedWinCount}）`,
  );
  console.log("========================================");
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
