#!/usr/bin/env node
/**
 * ハングダンプ再現スクリプト
 *
 * commit-bench の HANG_DUMPS_DIR に書かれた `hang-*.json` を読み、ハングした側と
 * 同じ worktree/難易度/randomFactor/evaluationOptions/bookEnabled で bridge worker
 * を起動して、記録されていた盤面・手番色で 1 手だけ要求する。
 *
 * `--replay-history` を付けると、その 1 手の前に**同じ worker に棋譜を打たせ直す**。
 * 既定は「ハングした局そのものの初手〜直前手」（v1 ダンプでも必ず持っている
 * `moveHistory`）。`--replay-history=N` にすると、さらに前段としてダンプの
 * `recentGames` から直近 N 局を先に再生する（v2 ダンプのみ）。
 *
 * 使い方:
 *   pnpm replay:hang bench-results/hang-dumps/hang-XXX.json
 *   pnpm replay:hang bench-results/hang-dumps/hang-XXX.json --replay-history
 *   pnpm replay:hang bench-results/hang-dumps/hang-XXX.json --replay-history=3
 *
 * オプション:
 *   --timeout-ms=<N>      1 手あたりの watchdog（既定: ダンプの bench.moveTimeoutMs）
 *   --verbose             レスポンス JSON を出力
 *   --no-recreate-worktree  worktree の作り直しを行わない
 *   --replay-history[=N]  上記の履歴再生。N は先行して再生する過去局数（既定 0）
 *
 * 出力:
 *   - dump のメタ情報（side/color/moveNumber/commit/eval options/telemetry）
 *   - 履歴再生の進捗と所要時間見積もり
 *   - watchdog までに応答が返れば所要時間・返された着手・depth・score
 *   - 返らなければ "HANG REPRODUCED" を表示して非0終了
 *
 * 注意: `ensureWorktree` は `.git/worktrees-bench/` を作り直すため、**commit-bench の
 * 走行中に実行してはいけない**（走行中の worktree を壊す）。
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type { BoardState, Position } from "../src/types/game.ts";
import type { EngineParamsSnapshot } from "./lib/workerTelemetry.ts";

import {
  diffEngineParams,
  isReadyMessage,
  parseEngineParams,
} from "./lib/bridgeWorkerProtocol.ts";
import {
  type HangDumpJson,
  type HangDumpJsonV2,
  isHangDumpV2,
} from "./lib/hangDump.ts";
import { deriveMoveSeed, nonOpeningOrdinalOf } from "./lib/hangReplay.ts";
import {
  type ReplayRequestOutcome,
  type ReplayStage,
  countPlannedRequests,
  runReplayStages,
} from "./lib/hangReplayRunner.ts";
import { buildReplayWorkerData } from "./lib/replayWorkerData.ts";
import { describeLivenessVerdict } from "./lib/workerLiveness.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** ダンプの想定上限サイズ。超えたら warn（棋譜が異常に長い等の早期検知） */
const DUMP_SIZE_WARN_BYTES = 8 * 1024 * 1024;

interface CliOptions {
  dumpPath: string;
  /** undefined ならダンプの bench.moveTimeoutMs を使う */
  timeoutMs?: number;
  verbose: boolean;
  /**
   * ダンプ記録時の worktree が既に消えている場合、その sha から
   * 元と同じパスに worktree を作り直す（pnpm install / build:wasm も実施）。
   * 既定 ON（現場運用ではダンプ後に bench の finally で消えているのが普通）。
   */
  recreateWorktree: boolean;
  /**
   * 履歴再生を行うか。ON なら必ず「ハング局の初手〜直前手」を再生する。
   */
  replayHistory: boolean;
  /**
   * さらに前段として再生する過去局数（dump.recentGames から新しい順に N 局）。
   * v2 ダンプのみ有効。0 ならハング局のみ。
   */
  replayHistoryGames: number;
}

const USAGE =
  "Usage: replay-hang <dump-path> [--timeout-ms=N] [--verbose] " +
  "[--no-recreate-worktree] [--replay-history[=N]]";

// ============================================================================
// CLI
// ============================================================================

function parseReplayHistoryArg(arg: string, options: CliOptions): void {
  options.replayHistory = true;
  const eq = arg.indexOf("=");
  if (eq === -1) {
    return;
  }
  const raw = arg.slice(eq + 1);
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 0) {
    console.error(`Error: --replay-history の値が不正です: ${raw}`);
    process.exit(1);
  }
  options.replayHistoryGames = parsed;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    dumpPath: "",
    verbose: false,
    recreateWorktree: true,
    replayHistory: false,
    replayHistoryGames: 0,
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
    } else if (
      arg === "--replay-history" ||
      arg.startsWith("--replay-history=")
    ) {
      parseReplayHistoryArg(arg, options);
    } else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
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
    console.error(USAGE);
    process.exit(1);
  }
  return options;
}

/**
 * ダンプに書かれた worktreePath が存在しなければ、commit sha から作り直す。
 * commit-bench の createWorktree と同等（node_modules と wasm も揃える）。
 *
 * **commit-bench 走行中に呼ばないこと**（同じ worktree ディレクトリを操作する）。
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
  const { size } = fs.statSync(abs);
  if (size > DUMP_SIZE_WARN_BYTES) {
    console.warn(
      `⚠ ダンプが想定より大きい (${(size / 1024 / 1024).toFixed(1)}MB)。読み込みに時間がかかります。`,
    );
  }
  const raw = fs.readFileSync(abs, "utf-8");
  const parsed = JSON.parse(raw) as HangDumpJson;
  if (parsed.type !== "hang-dump") {
    console.error(
      `Error: type=hang-dump ではありません (got: ${String(parsed.type)})`,
    );
    process.exit(1);
  }
  if (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) {
    console.warn(
      `⚠ 未知の schemaVersion=${String(parsed.schemaVersion)}。v2 として読み込みますが、` +
        `このスクリプトが古い可能性があります。`,
    );
  }
  return parsed;
}

// ============================================================================
// bridge worker 起動
// ============================================================================

interface SpawnedWorker {
  worker: Worker;
  /** ready 通知に載っていた実パラメータ（古い bridge worker なら undefined） */
  engineParams?: EngineParamsSnapshot;
}

function spawnBridgeWorker(
  dump: HangDumpJson,
  dumpEngineParams: EngineParamsSnapshot | undefined,
): Promise<SpawnedWorker> {
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

  return new Promise<SpawnedWorker>((resolve, reject) => {
    const worker = new Worker(workerPath, {
      // engineParams（timeLimit / maxNodes / depth / deterministic）を復元する。
      // 固定ノード局のハングを時間モードで再生しないため（lib/replayWorkerData.ts）
      workerData: buildReplayWorkerData(
        {
          worktreePath: dump.worker.worktreePath,
          difficulty: dump.worker.difficulty,
          randomFactor: dump.worker.randomFactor,
          evaluationOptions: dump.worker.evaluationOptions as
            | Record<string, unknown>
            | undefined,
          bookEnabled: dump.worker.bookEnabled,
        },
        dumpEngineParams,
      ),
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
      if (isReadyMessage(msg)) {
        clearTimeout(initTimer);
        worker.off("message", readyHandler);
        resolve({ worker, engineParams: parseEngineParams(msg) });
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

interface ReplayOutcome extends ReplayRequestOutcome {
  response?: MoveResponse;
}

/** リクエスト ID の採番（履歴再生で複数手を要求するため一意にする） */
let nextRequestId = 1;

function requestMoveWithWatchdog(
  worker: Worker,
  board: BoardState,
  color: "black" | "white",
  timeoutMs: number,
  moveSeed: number | undefined,
): Promise<ReplayOutcome> {
  return new Promise<ReplayOutcome>((resolve) => {
    const requestId = nextRequestId++;
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
// 表示
// ============================================================================

/**
 * v2 ダンプの worker 計測・生存信号・メインスレッド状態を人間向けに要約表示する。
 * v1 ダンプにはこれらが無いので、その旨だけを 1 行で知らせる。
 */
function printDiagnostics(dump: HangDumpJson): void {
  if (!isHangDumpV2(dump)) {
    console.log(
      `telemetry: (schemaVersion=${dump.schemaVersion} — worker 計測なし。` +
        `--replay-history はハング局の棋譜のみを再生します)`,
    );
    return;
  }
  const { telemetry } = dump.worker;
  const { engineParams, pendingRequest, recentMoves, requestCount } = telemetry;
  console.log(`telemetry: worker 起動からの要求数=${requestCount}`);
  if (engineParams) {
    console.log(
      `  engine=${engineParams.engine} depth=${engineParams.depth} timeLimit=${engineParams.timeLimit} maxNodes=${engineParams.maxNodes} deterministic=${engineParams.deterministic ?? false} threatProbe=${engineParams.threatProbe} statsBuffer=${engineParams.hasStatsBuffer}`,
    );
  }
  if (pendingRequest) {
    console.log(
      `  ハングした要求: requestId=${pendingRequest.requestId} move#${pendingRequest.moveNumber} ${pendingRequest.color} moveSeed=${pendingRequest.moveSeed ?? "unset"} sentAt=${pendingRequest.sentAt}`,
    );
  }
  if (recentMoves.length > 0) {
    console.log(`  直前 ${recentMoves.length} 手の思考統計（古→新）:`);
    for (const m of recentMoves) {
      console.log(
        `    g${m.gameIdx ?? "?"} move#${m.moveNumber} ${m.color} depth=${m.depth} score=${m.score} t=${Math.round(m.thinkingTimeMs)}ms interrupted=${m.interrupted} nodes=${m.stats?.nodes ?? "n/a"}`,
      );
    }
  }
  const { liveness, mainThread } = dump.hang;
  console.log(
    `  liveness: ${describeLivenessVerdict(liveness, engineParams?.deterministic)} lastAt=${liveness.lastTimeCheckAt ?? "n/a"}`,
  );
  console.log(
    `  mainThread: maxTimerLag=${mainThread.maxTimerLagMs}ms maxClockSkewJump=${mainThread.maxClockSkewJumpMs}ms samples=${mainThread.samples.length}`,
  );
  console.log(`  同一 worker の直前局: ${dump.recentGames.length} 局`);
}

function warnEngineParamsDiff(
  dump: HangDumpJson,
  actual: EngineParamsSnapshot | undefined,
): void {
  const expected = isHangDumpV2(dump)
    ? dump.worker.telemetry.engineParams
    : undefined;
  if (!expected) {
    console.warn(
      "⚠ ダンプに engineParams がありません（v1 ダンプ or 旧 bridge worker）。" +
        "replay の探索条件がダンプ時と一致している保証はありません。",
    );
    return;
  }
  if (!actual) {
    console.warn(
      "⚠ replay worker が params を返しませんでした（古い bridge worker）。突き合わせ不可。",
    );
    return;
  }
  const diffs = diffEngineParams(expected, actual);
  if (diffs.length === 0) {
    console.log("engineParams: ダンプと一致 ✓");
    return;
  }
  console.warn("⚠ engineParams がダンプと一致しません（再現性に影響します）:");
  for (const d of diffs) {
    console.warn(
      `    ${d.key}: dump=${JSON.stringify(d.expected)} replay=${JSON.stringify(d.actual)}`,
    );
  }
}

// ============================================================================
// 履歴再生ステージの組み立て
// ============================================================================

/**
 * 再生ステージを組み立てる。
 *
 * 1. `recentGames` から直近 N 局（古い順）— v2 ダンプのみ、`--replay-history=N` 指定時
 * 2. ハングした局そのものの初手〜直前手（`moveHistory`）— v1 でも必ずある
 */
function buildStages(dump: HangDumpJson, historyGames: number): ReplayStage[] {
  const stages: ReplayStage[] = [];
  if (historyGames > 0 && isHangDumpV2(dump)) {
    const games = (dump as HangDumpJsonV2).recentGames.slice(-historyGames);
    for (const game of games) {
      stages.push({
        label: `g${game.gameIdx} ${game.jushuName} (${game.isABlack ? "A黒" : "A白"})`,
        moves: game.moves,
        isABlack: game.isABlack,
        gameSeed: game.gameSeed,
      });
    }
  }
  stages.push({
    label: `ハング局 g${dump.match.gameIdx} ${dump.match.jushuName} (${dump.match.isABlack ? "A黒" : "A白"}) 初手〜直前手`,
    moves: dump.moveHistory.map((m) => ({
      row: m.row,
      col: m.col,
      isOpening: m.isOpening,
    })),
    isABlack: dump.match.isABlack,
    gameSeed: dump.match.gameSeed,
  });
  return stages;
}

/**
 * ハング手に使う moveSeed。**権威は telemetry.pendingRequest.moveSeed**。
 * 再導出はダンプ時と規則がずれるとサイレントに別 seed になるため、
 * 記録があればそれを使い、無いときだけ導出にフォールバックする。
 */
function resolveHangMoveSeed(dump: HangDumpJson): {
  moveSeed: number | undefined;
  source: string;
} {
  if (isHangDumpV2(dump)) {
    const pending = dump.worker.telemetry.pendingRequest;
    if (pending && pending.requestId === dump.hang.requestId) {
      return { moveSeed: pending.moveSeed, source: "telemetry.pendingRequest" };
    }
  }
  const moves = dump.moveHistory.map((m) => ({
    row: m.row,
    col: m.col,
    isOpening: m.isOpening,
  }));
  const ordinal = nonOpeningOrdinalOf(moves, dump.hang.moveNumber);
  return {
    moveSeed: deriveMoveSeed(dump.match.gameSeed, ordinal),
    source: `再導出 (nonOpeningOrdinal=${ordinal})`,
  };
}

// ============================================================================
// main
// ============================================================================

function printHeader(dump: HangDumpJson, timeoutMs: number): void {
  console.log(`\n=== Hang Dump Replay ===`);
  console.log(
    `timestamp: ${dump.timestamp} (schemaVersion=${dump.schemaVersion})`,
  );
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
  console.log(`watchdog: ${timeoutMs}ms (ダンプの moveTimeoutMs 既定)`);
  printDiagnostics(dump);
}

/** 直前手の思考時間から履歴再生の所要時間をざっくり見積もる。 */
function estimateReplaySeconds(
  dump: HangDumpJson,
  plannedRequests: number,
): number {
  const fallbackMs = dump.bench.moveTimeoutMs / 6;
  if (!isHangDumpV2(dump)) {
    return (plannedRequests * fallbackMs) / 1000;
  }
  const { recentMoves } = dump.worker.telemetry;
  if (recentMoves.length === 0) {
    return (plannedRequests * fallbackMs) / 1000;
  }
  const avg =
    recentMoves.reduce((sum, m) => sum + m.thinkingTimeMs, 0) /
    recentMoves.length;
  return (plannedRequests * avg) / 1000;
}

async function replayStagesOrExit(
  worker: Worker,
  dump: HangDumpJson,
  options: CliOptions,
  timeoutMs: number,
): Promise<void> {
  const stages = buildStages(dump, options.replayHistoryGames);
  if (options.replayHistoryGames > 0 && !isHangDumpV2(dump)) {
    console.warn(
      `⚠ --replay-history=${options.replayHistoryGames} 指定ですが、v1 ダンプには recentGames が` +
        `ありません。ハング局の棋譜だけを再生します。`,
    );
  }
  const planned = countPlannedRequests(stages, dump.hang.side);
  const etaSec = estimateReplaySeconds(dump, planned);
  console.log(
    `\n--- 履歴再生: ${stages.length} ステージ / ${planned} 手を要求（見積もり ≈ ${etaSec.toFixed(0)}s） ---`,
  );

  const start = performance.now();
  const result = await runReplayStages({
    stages,
    side: dump.hang.side,
    request: ({ board, color, moveSeed }) =>
      requestMoveWithWatchdog(worker, board, color, timeoutMs, moveSeed),
    onStageStart: (stage, count) => {
      console.log(`  [${stage.label}] ${count} 手`);
    },
    onRequestDone: (_stage, plannedRequest, outcome, doneCount) => {
      if (doneCount % 10 === 0 || outcome.status !== "responded") {
        console.log(
          `    ${doneCount}/${planned} move#${plannedRequest.moveNumber} ${(outcome.elapsedMs / 1000).toFixed(1)}s ${outcome.status}`,
        );
      }
    },
  });

  if (result.failure?.status === "timed-out") {
    const s = (result.failure.elapsedMs / 1000).toFixed(2);
    console.log(
      `\n✗ HANG REPRODUCED（履歴再生中） [${result.failure.stageLabel}] の ${result.failure.moveNumber} 手目で ${s}s 応答なし`,
    );
    console.log(`  この局面が根本原因調査の対象です。`);
    worker.terminate();
    process.exit(2);
  }
  if (result.failure) {
    console.log(
      `\n⚠ 履歴再生中に worker がエラー応答: [${result.failure.stageLabel}] の ${result.failure.moveNumber} 手目 — ${result.failure.errorMessage ?? "(不明)"}`,
    );
    console.log(`  ハング（無応答）ではありません。ここで中断します。`);
    worker.terminate();
    process.exit(1);
  }
  console.log(
    `--- 履歴再生完了: ${result.requestedMoves} 手 (${((performance.now() - start) / 1000).toFixed(1)}s) ---\n`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs();
  const dump = loadDump(options.dumpPath);
  const timeoutMs = options.timeoutMs ?? dump.bench.moveTimeoutMs;

  console.log(`dump: ${path.resolve(options.dumpPath)}`);
  printHeader(dump, timeoutMs);

  const hangSeed = resolveHangMoveSeed(dump);
  console.log(
    `  ハング手の moveSeed=${hangSeed.moveSeed ?? "unset"} (${hangSeed.source})`,
  );

  if (options.recreateWorktree) {
    ensureWorktree(dump);
  }

  console.log(`\nbridge worker を起動中...`);
  const dumpEngineParams = isHangDumpV2(dump)
    ? dump.worker.telemetry.engineParams
    : undefined;
  const { worker, engineParams } = await spawnBridgeWorker(
    dump,
    dumpEngineParams,
  );
  console.log(`起動完了。`);
  warnEngineParamsDiff(dump, engineParams);

  if (options.replayHistory) {
    await replayStagesOrExit(worker, dump, options, timeoutMs);
  }

  console.log(`ハング局面の1手要求を送信します...\n`);
  const outcome = await requestMoveWithWatchdog(
    worker,
    dump.board,
    dump.hang.color,
    timeoutMs,
    hangSeed.moveSeed,
  );
  worker.terminate();

  const elapsedS = (outcome.elapsedMs / 1000).toFixed(2);
  console.log(`\n=== 結果 ===`);
  if (outcome.status === "responded") {
    const r = outcome.response!;
    console.log(`✓ RESPONDED in ${elapsedS}s`);
    console.log(
      `  move: (${r.position.row}, ${r.position.col}) score=${r.score} depth=${r.depth} interrupted=${r.interrupted} thinkingTimeMs=${Math.round(r.thinkingTimeMs)}`,
    );
    if (options.verbose && r.stats) {
      console.log(`  stats: ${JSON.stringify(r.stats)}`);
    }
    console.log(
      `\n※ 再現せず。ダンプ時のハングは非決定的（実行環境・タイミング）か、` +
        `worker の探索そのものではない可能性があります。`,
    );
    if (!options.replayHistory) {
      console.log(
        `  次の一手: --replay-history（さらに --replay-history=N で過去 N 局も）を付けて再試行してください（#128）。`,
      );
    }
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
