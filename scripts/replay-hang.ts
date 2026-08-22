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
 *   --timeout-ms=<N>    watchdog タイムアウト（既定 60000ms）
 *   --verbose           レスポンス JSON を出力
 *   --replay-history    該当手の前に、同じ worker が直前に打った局（ダンプの
 *                       recentGames, schemaVersion>=2）を同じ順で再生してから
 *                       ハング局面を要求する。長時間稼働した worker の蓄積状態
 *                       （wasm メモリ・アロケータ・内部ヒューリスティック）に
 *                       依存する再現性を検証するためのモード（#128）。
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

import { applyMove } from "../src/logic/cpu/core/boardUtils.ts";
import { createEmptyBoard } from "../src/logic/renjuRules/index.ts";
import {
  type HangDumpJson,
  type HangDumpRecentGame,
  hangSideColor,
} from "./lib/hangDump.ts";
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
  /**
   * #128: ハング局面の前に、同じ worker が直前に打った局（dump.recentGames）を
   * 同じ順で再生する。TT/wasm メモリ等の蓄積状態を再現するため。
   * schemaVersion 1 のダンプには recentGames が無いので警告して素通しする。
   */
  replayHistory: boolean;
}

const USAGE =
  "Usage: replay-hang <dump-path> [--timeout-ms=60000] [--verbose] " +
  "[--no-recreate-worktree] [--replay-history]";

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
    replayHistory: false,
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
    } else if (arg === "--replay-history") {
      options.replayHistory = true;
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
// 履歴再生（--replay-history, #128）
// ============================================================================

/**
 * v2 ダンプの worker 計測（#128）を人間向けに要約表示する。
 * v1 ダンプには telemetry が無いので、その旨だけを 1 行で知らせる。
 */
function printTelemetry(dump: HangDumpJson): void {
  const { telemetry } = dump.worker;
  if (!telemetry) {
    console.log(
      `telemetry: (schemaVersion=${dump.schemaVersion} — worker 計測なし)`,
    );
    return;
  }
  const { engineParams, pendingRequest, recentMoves, requestCount } = telemetry;
  console.log(`telemetry: worker 起動からの要求数=${requestCount}`);
  if (engineParams) {
    console.log(
      `  engine=${engineParams.engine} depth=${engineParams.depth} timeLimit=${engineParams.timeLimit} maxNodes=${engineParams.maxNodes} threatProbe=${engineParams.threatProbe} statsBuffer=${engineParams.hasStatsBuffer}`,
    );
  }
  if (pendingRequest) {
    console.log(
      `  ハングした要求: requestId=${pendingRequest.requestId} move#${pendingRequest.moveNumber} ${pendingRequest.color} moveSeed=${pendingRequest.moveSeed ?? "unset"} sentAt=${pendingRequest.sentAt}`,
    );
  }
  if (recentMoves.length > 0) {
    console.log(`  直前 ${recentMoves.length} 手の思考統計:`);
    for (const m of recentMoves) {
      const nodes = m.stats?.nodes;
      console.log(
        `    g${m.gameIdx ?? "?"} move#${m.moveNumber} ${m.color} depth=${m.depth} score=${m.score} t=${Math.round(m.thinkingTimeMs)}ms nodes=${nodes ?? "n/a"}`,
      );
    }
  }
  const recentGames = dump.recentGames ?? [];
  console.log(
    `  同一 worker の直前局: ${recentGames.length} 局${recentGames.length > 0 ? ` (g${recentGames.map((g) => g.gameIdx).join(", g")})` : ""}`,
  );
}

/** 手番の色。開局手を含め黒→白→黒…と交互（連珠の手順そのもの）。 */
function colorOfMoveIndex(index: number): "black" | "white" {
  return index % 2 === 0 ? "black" : "white";
}

interface HistoryReplayResult {
  /** 実際に worker に投げた手数 */
  requestedMoves: number;
  /** 履歴再生の途中でハングしたか（したならそこが新しい調査対象） */
  hungAt?: { gameIdx: number; moveNumber: number; elapsedMs: number };
  /**
   * 履歴再生の途中で worker がエラー応答を返したか。
   * ハング（無応答）とは区別する — 混同すると誤診断になる。
   */
  erroredAt?: { gameIdx: number; moveNumber: number; message: string };
}

/**
 * ハングした worker が直前に打った局を、同じ worker インスタンスに同じ順で
 * 打たせ直す。相手側 worker は不要（ハングした側の手番だけを要求すればよい）。
 *
 * 目的は「長時間稼働した worker の蓄積状態でのみハングする」仮説の検証。
 * 単独再生（1手だけ）で再現しなかった #128 の実ダンプに対する次の一手。
 */
async function replayHistory(
  worker: Worker,
  dump: HangDumpJson,
  games: HangDumpRecentGame[],
  timeoutMs: number,
): Promise<HistoryReplayResult> {
  let requestedMoves = 0;
  for (const game of games) {
    const color = hangSideColor(dump.hang.side, game.isABlack);
    let board: BoardState = createEmptyBoard();
    let nonOpeningOrdinal = 0;
    console.log(
      `  g${game.gameIdx} ${game.jushuName} (${game.isABlack ? "A黒" : "A白"}) — ハング側=${color}, ${game.moves.length}手`,
    );
    for (const [index, move] of game.moves.entries()) {
      const moveColor = colorOfMoveIndex(index);
      if (!move.isOpening) {
        nonOpeningOrdinal++;
        if (moveColor === color) {
          const moveSeed =
            game.gameSeed === undefined
              ? undefined
              : mixSeed(game.gameSeed, nonOpeningOrdinal);
          // 逐次実行が必須: 同一 worker に交互要求するので並列化できない
          const outcome = await requestMoveWithWatchdog(
            worker,
            board,
            color,
            timeoutMs,
            moveSeed,
          );
          requestedMoves++;
          if (outcome.status === "timed-out") {
            return {
              requestedMoves,
              hungAt: {
                gameIdx: game.gameIdx,
                moveNumber: index + 1,
                elapsedMs: outcome.elapsedMs,
              },
            };
          }
          if (outcome.status === "error") {
            return {
              requestedMoves,
              erroredAt: {
                gameIdx: game.gameIdx,
                moveNumber: index + 1,
                message: outcome.errorMessage ?? "(不明なエラー)",
              },
            };
          }
        }
      }
      // 実際に打たれた手を適用する（worker の返した手ではなく棋譜どおりに進める）
      board = applyMove(board, { row: move.row, col: move.col }, moveColor);
    }
  }
  return { requestedMoves };
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
  console.log(`watchdog: ${options.timeoutMs}ms`);
  printTelemetry(dump);
  console.log();

  if (options.recreateWorktree) {
    ensureWorktree(dump);
  }

  console.log(`bridge worker を起動中...`);
  const worker = await spawnBridgeWorker(dump);
  console.log(`起動完了。`);

  if (options.replayHistory) {
    const recentGames = dump.recentGames ?? [];
    if (recentGames.length === 0) {
      console.warn(
        `⚠ --replay-history 指定ですが、このダンプに recentGames がありません` +
          `（schemaVersion=${dump.schemaVersion}、v2 未満の古いダンプ）。履歴再生をスキップします。`,
      );
    } else {
      console.log(
        `\n--- 履歴再生: 同一 worker に直前 ${recentGames.length} 局を打たせ直します ---`,
      );
      const historyStart = performance.now();
      const history = await replayHistory(
        worker,
        dump,
        recentGames,
        options.timeoutMs,
      );
      if (history.hungAt) {
        const s = (history.hungAt.elapsedMs / 1000).toFixed(2);
        console.log(
          `\n✗ HANG REPRODUCED（履歴再生中） g${history.hungAt.gameIdx} の ${history.hungAt.moveNumber} 手目で ${s}s 応答なし`,
        );
        console.log(
          `  蓄積状態依存のハングが再現しました。この局面が根本原因調査の対象です。`,
        );
        worker.terminate();
        process.exit(2);
      }
      if (history.erroredAt) {
        console.log(
          `\n⚠ 履歴再生中に worker がエラー応答: g${history.erroredAt.gameIdx} の ${history.erroredAt.moveNumber} 手目 — ${history.erroredAt.message}`,
        );
        console.log(
          `  ハング（無応答）ではありません。履歴再生を中断したためハング局面の要求は行いません。`,
        );
        worker.terminate();
        process.exit(1);
      }
      console.log(
        `--- 履歴再生完了: ${history.requestedMoves} 手を要求 (${((performance.now() - historyStart) / 1000).toFixed(1)}s) ---\n`,
      );
    }
  }

  console.log(`ハング局面の1手要求を送信します...\n`);

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
    if (!options.replayHistory) {
      console.log(
        `  次の一手: --replay-history を付けて同一 worker に直前局を打たせてから再試行してください（#128）。`,
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
