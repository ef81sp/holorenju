#!/usr/bin/env node
/**
 * ハングダンプ再現スクリプト
 *
 * commit-bench の HANG_DUMPS_DIR に書かれた `hang-*.json` を読み、ハングした側と
 * 同じ worktree/難易度/randomFactor/evaluationOptions/bookEnabled で bridge worker
 * を起動して、記録されていた盤面・手番色で1手だけ要求する。
 *
 * 使い方:
 *   pnpm exec-script scripts/replay-hang.ts bench-results/hang-dumps/hang-XXX.json
 *   # または直接 node で:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     --import ./scripts/register-loader.mjs scripts/replay-hang.ts <dump-path>
 *
 * オプション:
 *   --timeout-ms=<N>   watchdog タイムアウト（既定 60000ms）
 *   --verbose          レスポンス JSON を出力
 *
 * 出力:
 *   - dump のメタ情報（side/color/moveNumber/commit/eval options）
 *   - watchdog タイムアウトまでに応答が返れば所要時間・返された着手・depth・score
 *   - 返らなければ "HANG (timed out)" を表示して非0終了
 *
 * このスクリプトはハング局面を再現できるかを確認するためのもので、bench 全体を
 * 走らせずに再現条件を絞り込む。
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type { BoardState, Position } from "../src/types/game.ts";
import type { HangDumpJson } from "./lib/hangDump.ts";

import { buildBridgeCustomParams } from "./lib/match.ts";
import { mixSeed } from "./lib/mulberry32.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface CliOptions {
  dumpPath: string;
  timeoutMs: number;
  verbose: boolean;
  /**
   * ダンプ記録時の worktree が既に消えている場合、その sha から
   * 元と同じパスに worktree を作り直す（pnpm install / build:wasm も実施）。
   * 既定 ON（現場運用ではダンプ後に bench の finally で消えているのが普通）。
   */
  recreateWorktree: boolean;
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    dumpPath: "",
    timeoutMs: 60000,
    verbose: false,
    recreateWorktree: true,
  };
  for (const arg of args) {
    if (arg.startsWith("--timeout-ms=")) {
      const v = parseInt(arg.slice("--timeout-ms=".length), 10);
      if (!isNaN(v) && v > 0) {
        options.timeoutMs = v;
      }
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--no-recreate-worktree") {
      options.recreateWorktree = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: replay-hang <dump-path> [--timeout-ms=60000] [--verbose] [--no-recreate-worktree]",
      );
      process.exit(0);
    } else if (arg.startsWith("--")) {
      console.error(`Error: 不明な引数: ${arg}`);
      process.exit(1);
    } else {
      options.dumpPath = arg;
    }
  }
  if (options.dumpPath === "") {
    console.error("Error: ダンプファイルのパスを指定してください");
    console.error(
      "Usage: replay-hang <dump-path> [--timeout-ms=60000] [--verbose] [--no-recreate-worktree]",
    );
    process.exit(1);
  }
  return options;
}

/**
 * ダンプに書かれた worktreePath が存在しなければ、commit sha から作り直す。
 * commit-bench の createWorktree と同等（node_modules と wasm も揃える）。
 * 副作用で worktree を追加する。呼び出し元に removal は任せる（プロセス終了で
 * 残るが、次回 commit-bench が同じ label で作り直すときに --force で消える）。
 */
function ensureWorktree(dump: HangDumpJson): void {
  const wt = dump.worker.worktreePath;
  if (fs.existsSync(path.join(wt, "scripts", "register-loader.mjs"))) {
    return;
  }
  const { sha } = dump.worker.commit;
  console.log(
    `worktree が存在しないため sha=${dump.worker.commit.shortSha} から作り直します: ${wt}`,
  );

  // worktree ディレクトリの親（.git/worktrees-bench 相当）を作る
  const parent = path.dirname(wt);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  // 既存の git worktree レコード（壊れた prune 前のもの）を掃除
  try {
    execSync(`git worktree remove --force "${wt}"`, { stdio: "pipe" });
  } catch {
    // ignore — 元々ない可能性が高い
  }

  execSync(`git worktree add "${wt}" ${sha}`, { stdio: "inherit" });

  if (!fs.existsSync(path.join(wt, "node_modules"))) {
    console.log("pnpm install (--ignore-scripts)...");
    execSync("pnpm install --frozen-lockfile --ignore-scripts", {
      cwd: wt,
      stdio: "inherit",
    });
  }

  const wasmPath = path.join(wt, "zig", "zig-out", "bin", "cpu-engine.wasm");
  if (
    !fs.existsSync(wasmPath) &&
    fs.existsSync(path.join(wt, "zig", "build.zig"))
  ) {
    console.log("WASM をビルド中 (pnpm build:wasm)...");
    execSync("pnpm build:wasm", { cwd: wt, stdio: "inherit" });
  }

  // register-loader.mjs / loader.ts をコピー（commit-bench の createWorktree と同等）
  const wtLoaderMjs = path.join(wt, "scripts", "register-loader.mjs");
  if (!fs.existsSync(wtLoaderMjs)) {
    fs.copyFileSync(path.join(__dirname, "register-loader.mjs"), wtLoaderMjs);
  }
  const wtLoaderTs = path.join(wt, "scripts", "loader.ts");
  if (!fs.existsSync(wtLoaderTs)) {
    fs.copyFileSync(path.join(__dirname, "loader.ts"), wtLoaderTs);
  }
}

function loadDump(dumpPath: string): HangDumpJson {
  const abs = path.resolve(dumpPath);
  if (!fs.existsSync(abs)) {
    console.error(`Error: ダンプファイルが見つかりません: ${abs}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(abs, "utf-8");
  const parsed = JSON.parse(raw) as HangDumpJson;
  if (parsed.type !== "hang-dump") {
    console.error(
      `Error: type=hang-dump ではありません (got: ${parsed.type as string})`,
    );
    process.exit(1);
  }
  return parsed;
}

// ============================================================================
// bridge worker 起動
// ============================================================================

function spawnBridgeWorker(dump: HangDumpJson): Promise<Worker> {
  const workerPath = path.join(__dirname, "cpu-bridge-worker.ts");
  const loaderPath = path.join(
    dump.worker.worktreePath,
    "scripts",
    "register-loader.mjs",
  );
  if (!fs.existsSync(loaderPath)) {
    console.error(
      `Error: worktree の register-loader.mjs が見つかりません: ${loaderPath}\n` +
        `  --no-recreate-worktree で明示的に無効化されているか、作り直しに失敗しています。`,
    );
    process.exit(1);
  }

  const customParams = buildBridgeCustomParams(
    dump.worker.randomFactor,
    dump.worker.evaluationOptions,
  );

  return new Promise<Worker>((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: {
        worktreePath: dump.worker.worktreePath,
        difficulty: dump.worker.difficulty,
        customParams,
        bookEnabled: dump.worker.bookEnabled,
      },
      execArgv: [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "--import",
        loaderPath,
      ],
    });

    const initTimer = setTimeout(() => {
      worker.terminate();
      reject(new Error("bridge worker の初期化がタイムアウト (60s)"));
    }, 60000);

    const readyHandler = (msg: unknown): void => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        "ready" in msg &&
        (msg as { ready: unknown }).ready === true
      ) {
        clearTimeout(initTimer);
        worker.off("message", readyHandler);
        resolve(worker);
      }
    };
    worker.on("message", readyHandler);
    worker.on("error", (err) => {
      clearTimeout(initTimer);
      reject(err);
    });
  });
}

// ============================================================================
// 1手要求（watchdog 付き）
// ============================================================================

interface MoveResponse {
  requestId: number;
  position: Position;
  score: number;
  depth: number;
  thinkingTimeMs: number;
  interrupted: boolean;
  stats?: Record<string, number>;
}

interface ReplayOutcome {
  status: "responded" | "timed-out" | "error";
  elapsedMs: number;
  response?: MoveResponse;
  errorMessage?: string;
}

function requestMoveWithWatchdog(
  worker: Worker,
  board: BoardState,
  color: "black" | "white",
  timeoutMs: number,
  moveSeed: number | undefined,
): Promise<ReplayOutcome> {
  return new Promise<ReplayOutcome>((resolve) => {
    const requestId = 1;
    const start = performance.now();

    const timer = setTimeout(() => {
      worker.off("message", handler);
      resolve({
        status: "timed-out",
        elapsedMs: performance.now() - start,
      });
    }, timeoutMs);

    const handler = (msg: unknown): void => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        "requestId" in msg &&
        (msg as { requestId: unknown }).requestId === requestId
      ) {
        worker.off("message", handler);
        clearTimeout(timer);
        const elapsedMs = performance.now() - start;
        if ("error" in msg) {
          resolve({
            status: "error",
            elapsedMs,
            errorMessage: String((msg as { error: unknown }).error),
          });
        } else {
          resolve({
            status: "responded",
            elapsedMs,
            response: msg as MoveResponse,
          });
        }
      }
    };
    worker.on("message", handler);
    worker.postMessage({ requestId, board, color, moveSeed });
  });
}

// ============================================================================
// main
// ============================================================================

async function main(): Promise<void> {
  const options = parseArgs();
  const dump = loadDump(options.dumpPath);

  console.log(`\n=== Hang Dump Replay ===`);
  console.log(`dump: ${path.resolve(options.dumpPath)}`);
  console.log(`timestamp: ${dump.timestamp}`);
  console.log(
    `match: g${dump.match.gameIdx} ${dump.match.jushuName} (${dump.match.isABlack ? "A黒" : "A白"})`,
  );
  console.log(
    `hang: side=${dump.hang.side} color=${dump.hang.color} moveNumber=${dump.hang.moveNumber} elapsedMs=${Math.round(dump.hang.elapsedMs)} original-timeoutMs=${dump.hang.timeoutMs}`,
  );
  console.log(
    `worker: ${dump.worker.commit.shortSha} "${dump.worker.commit.message}"`,
  );
  console.log(`  worktree: ${dump.worker.worktreePath}`);
  console.log(
    `  difficulty=${dump.worker.difficulty} randomFactor=${dump.worker.randomFactor ?? "unset"} bookEnabled=${dump.worker.bookEnabled}`,
  );
  console.log(
    `  evaluationOptions: ${dump.worker.evaluationOptions ? JSON.stringify(dump.worker.evaluationOptions) : "(未指定)"}`,
  );
  // gameSeed とハング時の非オープニング要求番号から moveSeed を復元。
  // ダンプ側でこれらが両方あれば、randomFactor の近傍ランダム化まで再現できる。
  const nonOpeningOrdinal =
    dump.hang.moveNumber - dump.moveHistory.filter((m) => m.isOpening).length;
  const moveSeed =
    dump.match.gameSeed !== undefined && nonOpeningOrdinal >= 1
      ? mixSeed(dump.match.gameSeed, nonOpeningOrdinal)
      : undefined;
  console.log(
    `  seed: gameSeed=${dump.match.gameSeed ?? "unset"} → moveSeed=${moveSeed ?? "unset"} (nonOpeningOrdinal=${nonOpeningOrdinal})`,
  );
  console.log(`watchdog: ${options.timeoutMs}ms\n`);

  if (options.recreateWorktree) {
    ensureWorktree(dump);
  }

  console.log(`bridge worker を起動中...`);
  const worker = await spawnBridgeWorker(dump);
  console.log(`起動完了。1手要求を送信します...\n`);

  const outcome = await requestMoveWithWatchdog(
    worker,
    dump.board,
    dump.hang.color,
    options.timeoutMs,
    moveSeed,
  );
  worker.terminate();

  const elapsedS = (outcome.elapsedMs / 1000).toFixed(2);
  console.log(`\n=== 結果 ===`);
  if (outcome.status === "responded") {
    const r = outcome.response!;
    console.log(`✓ RESPONDED in ${elapsedS}s`);
    console.log(
      `  move: (${r.position.row}, ${r.position.col}) score=${r.score} depth=${r.depth} thinkingTimeMs=${Math.round(r.thinkingTimeMs)}`,
    );
    if (options.verbose && r.stats) {
      console.log(`  stats: ${JSON.stringify(r.stats)}`);
    }
    console.log(
      `\n※ 再現せず。ダンプ時のハングは非決定的（TT/randomFactor/実行環境）か、` +
        `wasm 側の状態依存の可能性があります。`,
    );
    process.exit(0);
  }
  if (outcome.status === "timed-out") {
    console.log(
      `✗ HANG REPRODUCED — worker did not respond within ${elapsedS}s`,
    );
    console.log(
      `  ダンプと同じ盤面・設定でハングが再現しました。この局面が根本原因調査の対象です。`,
    );
    process.exit(2);
  }
  console.log(`⚠ ERROR: ${outcome.errorMessage}`);
  process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${msg}`);
  process.exit(1);
});
