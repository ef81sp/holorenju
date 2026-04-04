#!/usr/bin/env node
/**
 * コミット間CPU強度比較ベンチマーク CLI
 *
 * 2つのgit commitのCPU実装を対戦させ、強度の変化を検証する。
 *
 * 使用例:
 *   pnpm commit:bench --commitA=HEAD~1 --commitB=HEAD --games=10
 *   pnpm commit:bench --commitA=abc1234 --commitB=def5678 --sprt
 *   pnpm commit:bench --games=200 --difficulty=medium
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type { CpuDifficulty } from "../src/types/cpu.ts";
import type { Position } from "../src/types/game.ts";
import type { SPRTConfig, WDLCount } from "./types/ab.ts";
import type {
  CommitBenchResult,
  CommitGameResult,
  CommitInfo,
  PlayerPerformanceStats,
} from "./types/commit-bench.ts";

import {
  getAllJushuNames,
  getJushuPositions,
} from "../src/logic/cpu/opening.ts";
import { runCommitGame } from "./commit-game-runner.ts";
import { estimateEloDiff, formatEloDiff } from "./lib/eloDiff.ts";
import { DEFAULT_SPRT_CONFIG, formatSPRT, updateSPRT } from "./lib/sprt.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "bench-results");
const WORKTREES_DIR = path.join(PROJECT_ROOT, ".git", "worktrees-bench");

// ============================================================================
// CLI引数パース
// ============================================================================

interface CliOptions {
  refA: string;
  refB: string;
  sets: number;
  difficulty: CpuDifficulty;
  useSPRT: boolean;
  sprtElo0: number;
  sprtElo1: number;
  sprtAlpha: number;
  sprtBeta: number;
  randomFactor?: number;
  verbose: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    refA: "HEAD~1",
    refB: "HEAD",
    sets: 1,
    difficulty: "hard",
    useSPRT: false,
    sprtElo0: DEFAULT_SPRT_CONFIG.elo0,
    sprtElo1: DEFAULT_SPRT_CONFIG.elo1,
    sprtAlpha: DEFAULT_SPRT_CONFIG.alpha,
    sprtBeta: DEFAULT_SPRT_CONFIG.beta,
    verbose: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--commitA=")) {
      options.refA = arg.slice("--commitA=".length);
    } else if (arg.startsWith("--commitB=")) {
      options.refB = arg.slice("--commitB=".length);
    } else if (arg.startsWith("--sets=")) {
      const value = parseInt(arg.slice("--sets=".length), 10);
      if (!isNaN(value) && value > 0) {
        options.sets = value;
      }
    } else if (arg.startsWith("--difficulty=")) {
      const value = arg.slice("--difficulty=".length);
      if (["beginner", "easy", "medium", "hard"].includes(value)) {
        options.difficulty = value as CpuDifficulty;
      }
    } else if (arg === "--sprt") {
      options.useSPRT = true;
    } else if (arg.startsWith("--elo0=")) {
      const value = parseFloat(arg.slice("--elo0=".length));
      if (!isNaN(value)) {
        options.sprtElo0 = value;
        options.useSPRT = true;
      }
    } else if (arg.startsWith("--elo1=")) {
      const value = parseFloat(arg.slice("--elo1=".length));
      if (!isNaN(value)) {
        options.sprtElo1 = value;
        options.useSPRT = true;
      }
    } else if (arg.startsWith("--randomFactor=")) {
      const value = parseFloat(arg.slice("--randomFactor=".length));
      if (!isNaN(value) && value >= 0 && value <= 1) {
        options.randomFactor = value;
      } else {
        console.error(
          `Error: --randomFactor は 0〜1 の範囲で指定してください (got: ${arg.slice("--randomFactor=".length)})`,
        );
        process.exit(1);
      }
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
コミット間CPU強度比較ベンチマーク

Usage:
  pnpm commit:bench [options]

Options:
  --commitA=<sha|ref>    比較元コミット (default: HEAD~1)
  --commitB=<sha|ref>    比較先コミット (default: HEAD)
  --sets=<n>             セット数 (1セット = 26珠型 × 2色 = 52局, default: 1)
  --difficulty=<d>       難易度 beginner|easy|medium|hard (default: hard)
  --sprt                 SPRT早期停止を有効化
  --elo0=<n>             SPRT帰無仮説Elo差 (default: 0)
  --elo1=<n>             SPRT対立仮説Elo差 (default: 30)
  --randomFactor=<n>     探索にゆらぎを加える (0〜1, default: なし)
  --verbose, -v          詳細ログ
  --help, -h             ヘルプを表示

Examples:
  pnpm commit:bench --commitA=HEAD~1 --commitB=HEAD --sets=1
  pnpm commit:bench --commitA=abc1234 --commitB=def5678 --sprt --elo0=0 --elo1=30
`);
}

// ============================================================================
// 性能統計集計
// ============================================================================

function computePerformanceStats(games: CommitGameResult[]): {
  A: PlayerPerformanceStats;
  B: PlayerPerformanceStats;
} {
  const acc = {
    A: { depthSum: 0, timeSum: 0, count: 0, maxDepth: 0 },
    B: { depthSum: 0, timeSum: 0, count: 0, maxDepth: 0 },
  };

  for (const game of games) {
    for (let i = 0; i < game.moveHistory.length; i++) {
      const move = game.moveHistory[i]!;
      if (move.isOpening) {
        continue;
      }

      // 偶数手(0,2,4...)=黒番、奇数手=白番
      // isABlackでA/Bを判定
      const isBlackMove = i % 2 === 0;
      const player =
        (isBlackMove && game.isABlack) || (!isBlackMove && !game.isABlack)
          ? "A"
          : "B";
      const a = acc[player];

      if (move.depth !== undefined) {
        a.depthSum += move.depth;
        a.maxDepth = Math.max(a.maxDepth, move.depth);
      }
      a.timeSum += move.time;
      a.count++;
    }
  }

  function toStats(a: {
    depthSum: number;
    timeSum: number;
    count: number;
    maxDepth: number;
  }): PlayerPerformanceStats {
    return {
      searchedMoves: a.count,
      avgDepth: a.count > 0 ? a.depthSum / a.count : 0,
      maxDepth: a.maxDepth,
      avgThinkingTime: a.count > 0 ? a.timeSum / a.count : 0,
    };
  }

  return { A: toStats(acc.A), B: toStats(acc.B) };
}

// ============================================================================
// ステータス表示
// ============================================================================

function writeStatus(message: string): void {
  process.stdout.write(`\r${message.padEnd(100)}`);
}

function clearStatus(): void {
  process.stdout.write(`\r${" ".repeat(100)}\r`);
}

// ============================================================================
// Gitユーティリティ
// ============================================================================

function getCommitInfo(refOrSha: string): CommitInfo {
  try {
    const sha = execSync(`git rev-parse ${refOrSha}`, {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    }).trim();
    const shortSha = sha.slice(0, 7);
    const message = execSync(`git log --format=%s -1 ${sha}`, {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    }).trim();
    const date = execSync(`git log --format=%ci -1 ${sha}`, {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    }).trim();
    return { sha, shortSha, message, date };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: コミット情報の取得に失敗 (${refOrSha}): ${msg}`);
    process.exit(1);
  }
}

function createWorktree(sha: string, label: string): string {
  const worktreePath = path.join(WORKTREES_DIR, `${label}-${sha.slice(0, 7)}`);

  // 既存のworktreeがあれば除去
  if (fs.existsSync(worktreePath)) {
    console.log(`Removing existing worktree at ${worktreePath}...`);
    execSync(`git worktree remove --force "${worktreePath}"`, {
      cwd: PROJECT_ROOT,
    });
  }

  // worktreesディレクトリを作成
  if (!fs.existsSync(WORKTREES_DIR)) {
    fs.mkdirSync(WORKTREES_DIR, { recursive: true });
  }

  // worktreeを作成
  console.log(`Creating worktree for ${label} (${sha.slice(0, 7)})...`);
  execSync(`git worktree add "${worktreePath}" ${sha}`, {
    cwd: PROJECT_ROOT,
  });

  // node_modulesが存在しない場合のみpnpm install
  // --ignore-scripts: worktreeでlefthook prepare が失敗するのを回避
  if (!fs.existsSync(path.join(worktreePath, "node_modules"))) {
    console.log(`Installing node_modules for ${label}...`);
    execSync("pnpm install --frozen-lockfile --ignore-scripts", {
      cwd: worktreePath,
      stdio: "inherit",
    });
  }

  // WASMビルド（zigが利用可能かつbuild.zigが存在する場合）
  const zigBuildFile = path.join(worktreePath, "zig", "build.zig");
  if (fs.existsSync(zigBuildFile)) {
    const wasmPath = path.join(
      worktreePath,
      "zig",
      "zig-out",
      "bin",
      "cpu-engine.wasm",
    );
    if (!fs.existsSync(wasmPath)) {
      try {
        console.log(`Building WASM for ${label}...`);
        execSync("pnpm build:wasm", {
          cwd: worktreePath,
          stdio: "pipe",
          timeout: 120000,
        });
        console.log(`WASM build succeeded for ${label}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `WASM build failed for ${label} (will use TS fallback): ${msg}`,
        );
      }
    }
  }

  // register-loader.mjsが存在しない場合はコピー
  const worktreeLoaderMjs = path.join(
    worktreePath,
    "scripts",
    "register-loader.mjs",
  );
  if (!fs.existsSync(worktreeLoaderMjs)) {
    const currentLoaderMjs = path.join(__dirname, "register-loader.mjs");
    fs.copyFileSync(currentLoaderMjs, worktreeLoaderMjs);
    console.log(`Copied register-loader.mjs to ${label} worktree`);
  }

  // loader.tsが存在しない場合はコピー
  const worktreeLoaderTs = path.join(worktreePath, "scripts", "loader.ts");
  if (!fs.existsSync(worktreeLoaderTs)) {
    const currentLoaderTs = path.join(__dirname, "loader.ts");
    fs.copyFileSync(currentLoaderTs, worktreeLoaderTs);
    console.log(`Copied loader.ts to ${label} worktree`);
  }

  return worktreePath;
}

function removeWorktree(worktreePath: string): void {
  if (fs.existsSync(worktreePath)) {
    try {
      execSync(`git worktree remove --force "${worktreePath}"`, {
        cwd: PROJECT_ROOT,
        stdio: "pipe",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: worktree removal failed: ${msg}`);
    }
  }
}

// ============================================================================
// Bridge Worker管理
// ============================================================================

function createBridgeWorker(
  worktreePath: string,
  difficulty: string,
  randomFactor?: number,
): Promise<Worker> {
  return new Promise<Worker>((resolve, reject) => {
    const workerPath = path.join(__dirname, "cpu-bridge-worker.ts");

    const customParams =
      randomFactor === undefined ? undefined : { randomFactor };

    const worker = new Worker(workerPath, {
      workerData: { worktreePath, difficulty, customParams },
      execArgv: [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "--import",
        path.join(worktreePath, "scripts", "register-loader.mjs"),
      ],
    });

    const initTimeout = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(`Bridge worker initialization timed out for ${worktreePath}`),
      );
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

// ============================================================================
// メイン処理
// ============================================================================

async function main(): Promise<void> {
  const options = parseArgs();
  const startTime = performance.now();

  // コミット情報を取得
  const commitA = getCommitInfo(options.refA);
  const commitB = getCommitInfo(options.refB);

  const sprtConfig: SPRTConfig | null = options.useSPRT
    ? {
        elo0: options.sprtElo0,
        elo1: options.sprtElo1,
        alpha: options.sprtAlpha,
        beta: options.sprtBeta,
      }
    : null;

  const jushuNames = getAllJushuNames();
  const gamesPerSet = jushuNames.length * 2; // 26珠型 × 2色
  const totalGames = options.sets * gamesPerSet;

  console.log(`\n=== コミット間CPU強度比較ベンチマーク ===`);
  console.log(
    `commitA: ${commitA.shortSha} "${commitA.message}" (${commitA.date})`,
  );
  console.log(
    `commitB: ${commitB.shortSha} "${commitB.message}" (${commitB.date})`,
  );
  console.log(
    `難易度: ${options.difficulty}${options.randomFactor === undefined ? "" : ` (randomFactor=${options.randomFactor})`}`,
  );
  console.log(
    `セット数: ${options.sets} (${gamesPerSet}局/セット, 計${totalGames}局)`,
  );
  if (sprtConfig) {
    console.log(
      `SPRT: elo0=${sprtConfig.elo0}, elo1=${sprtConfig.elo1}, ` +
        `alpha=${sprtConfig.alpha}, beta=${sprtConfig.beta}`,
    );
  }
  console.log();

  let worktreePathA: string | null = null;
  let worktreePathB: string | null = null;
  let workerA: Worker | null = null;
  let workerB: Worker | null = null;

  // クリーンアップ関数
  const cleanup = (): void => {
    if (workerA) {
      workerA.terminate();
      workerA = null;
    }
    if (workerB) {
      workerB.terminate();
      workerB = null;
    }
    if (worktreePathA) {
      removeWorktree(worktreePathA);
      worktreePathA = null;
    }
    if (worktreePathB) {
      removeWorktree(worktreePathB);
      worktreePathB = null;
    }
  };

  // SIGINT ハンドラー（Ctrl+C）
  process.on("SIGINT", () => {
    clearStatus();
    console.log("\n中断されました。クリーンアップ中...");
    cleanup();
    process.exit(130);
  });

  try {
    // worktreeを作成
    worktreePathA = createWorktree(commitA.sha, "A");
    worktreePathB = createWorktree(commitB.sha, "B");

    // bridge workerを起動
    console.log("Bridge workerを初期化中...");
    [workerA, workerB] = await Promise.all([
      createBridgeWorker(
        worktreePathA,
        options.difficulty,
        options.randomFactor,
      ),
      createBridgeWorker(
        worktreePathB,
        options.difficulty,
        options.randomFactor,
      ),
    ]);
    console.log("Bridge worker初期化完了\n");

    // 珠型タスクリスト生成（フラット化）
    interface CommitJushuTask {
      jushuName: string;
      positions: [Position, Position, Position];
      isABlack: boolean;
    }
    const jushuTasks: CommitJushuTask[] = [];
    for (let set = 0; set < options.sets; set++) {
      for (const jn of jushuNames) {
        const pos = getJushuPositions(jn, true);
        if (!pos) {
          continue;
        }
        for (const ab of [true, false]) {
          jushuTasks.push({ jushuName: jn, positions: pos, isABlack: ab });
        }
      }
    }

    // WDL集計（commitA視点）
    const wdl: WDLCount = { wins: 0, draws: 0, losses: 0 };
    const games: CommitGameResult[] = [];
    let completedGames = 0;

    // 累積性能統計アキュムレータ
    const cumAcc = {
      A: { depthSum: 0, timeSum: 0, count: 0, maxDepth: 0 },
      B: { depthSum: 0, timeSum: 0, count: 0, maxDepth: 0 },
    };

    // 珠型セット制で逐次実行（同じworkerを使い回すため意図的な順次実行）
    for (const { jushuName, positions, isABlack } of jushuTasks) {
      const result = await runCommitGame(workerA, workerB, isABlack, {
        verbose: options.verbose,
        moveTimeoutMs: 30000,
        openingMoves: positions,
      });

      // WDL更新（commitA = playerA 視点）
      if (result.winner === "draw") {
        wdl.draws++;
      } else if (result.winner === "A") {
        wdl.wins++;
      } else {
        wdl.losses++;
      }

      games.push({ ...result, jushuName });

      completedGames++;

      // 初回ゲーム後のサニティチェック
      if (completedGames === 1) {
        const avgTime =
          result.moveHistory.reduce(
            (s: number, m: { time: number }) => s + m.time,
            0,
          ) / result.moveHistory.length;
        const maxTime = Math.max(
          ...result.moveHistory.map((m: { time: number }) => m.time),
        );
        console.log(`\n[サニティチェック] 初回ゲーム完了`);
        console.log(
          `  手数: ${result.moves} | 勝者: ${result.winner} | 理由: ${result.reason}`,
        );
        console.log(
          `  平均思考時間: ${Math.round(avgTime)}ms | 最大: ${Math.round(maxTime)}ms`,
        );
        console.log(`  duration: ${Math.round(result.duration)}ms`);
        if (avgTime < 1) {
          console.warn(
            "  ⚠ 平均思考時間が1ms未満 — エンジンが正しくロードされていない可能性",
          );
        }
      }

      // この局のA/B統計を集計し、累積にも加算
      const gameAcc = {
        A: { depthSum: 0, timeSum: 0, count: 0, maxDepth: 0 },
        B: { depthSum: 0, timeSum: 0, count: 0, maxDepth: 0 },
      };
      for (let i = 0; i < result.moveHistory.length; i++) {
        const move = result.moveHistory[i]!;
        if (move.isOpening) {
          continue;
        }
        const isBlackMove = i % 2 === 0;
        const player =
          (isBlackMove && isABlack) || (!isBlackMove && !isABlack) ? "A" : "B";
        const ga = gameAcc[player];
        const ca = cumAcc[player];
        if (move.depth !== undefined) {
          ga.depthSum += move.depth;
          ga.maxDepth = Math.max(ga.maxDepth, move.depth);
          ca.depthSum += move.depth;
          ca.maxDepth = Math.max(ca.maxDepth, move.depth);
        }
        ga.timeSum += move.time;
        ga.count++;
        ca.timeSum += move.time;
        ca.count++;
      }

      // ステータス表示
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(0);
      const elo = estimateEloDiff(wdl);
      let statusMsg = `[${elapsed}s] ${completedGames}/${totalGames} ${jushuName} ${isABlack ? "A黒" : "A白"} +${wdl.wins}=${wdl.draws}-${wdl.losses} Elo:${elo.eloDiff > 0 ? "+" : ""}${elo.eloDiff}`;

      if (sprtConfig) {
        const sprt = updateSPRT(wdl, sprtConfig);
        statusMsg += ` LLR:${sprt.llr.toFixed(2)}`;
        if (sprt.decision !== "continue") {
          writeStatus(statusMsg);
          clearStatus();
          console.log(
            `SPRT判定: ${sprt.decision} (${completedGames}局目で停止)`,
          );
          break;
        }
      }

      writeStatus(statusMsg);

      // 1局ごとの性能統計（改行で表示）
      const fmtDepth = (a: {
        depthSum: number;
        timeSum: number;
        count: number;
      }): string =>
        a.count > 0
          ? `d=${(a.depthSum / a.count).toFixed(1)} t=${Math.round(a.timeSum / a.count)}ms`
          : "n/a";
      const fmtCum = (a: {
        depthSum: number;
        count: number;
        maxDepth: number;
        timeSum: number;
      }): string =>
        a.count > 0
          ? `d=${(a.depthSum / a.count).toFixed(2)} max=${a.maxDepth} t=${Math.round(a.timeSum / a.count)}ms`
          : "n/a";
      console.log(
        `\n  局: A[${fmtDepth(gameAcc.A)}] B[${fmtDepth(gameAcc.B)}] | 累計: A[${fmtCum(cumAcc.A)}] B[${fmtCum(cumAcc.B)}]`,
      );
    }

    clearStatus();

    const elapsedSeconds = (performance.now() - startTime) / 1000;

    // 結果表示
    console.log(`\n=== 結果 ===`);
    console.log(`commitA: ${commitA.shortSha} "${commitA.message}"`);
    console.log(`commitB: ${commitB.shortSha} "${commitB.message}"`);
    console.log(`対局数: ${completedGames}`);
    console.log(`WDL (commitA視点): +${wdl.wins} =${wdl.draws} -${wdl.losses}`);

    const eloDiffResult = estimateEloDiff(wdl);
    console.log(formatEloDiff(eloDiffResult));

    let sprtState = null;
    if (sprtConfig) {
      sprtState = updateSPRT(wdl, sprtConfig);
      console.log(formatSPRT(sprtState, wdl));
    }

    console.log(`所要時間: ${elapsedSeconds.toFixed(1)}秒`);

    // A/Bごとの性能統計を集計
    const performanceStats = computePerformanceStats(games);
    console.log(`\n--- 性能統計 ---`);
    for (const [label, stats] of [
      ["A", performanceStats.A],
      ["B", performanceStats.B],
    ] as const) {
      console.log(
        `  ${label}: 平均深度=${stats.avgDepth.toFixed(2)} 最大深度=${stats.maxDepth} 平均思考時間=${Math.round(stats.avgThinkingTime)}ms (${stats.searchedMoves}手)`,
      );
    }

    // 結果保存
    const benchResult: CommitBenchResult = {
      type: "commit-bench",
      timestamp: new Date().toISOString(),
      commitA,
      commitB,
      config: {
        difficulty: options.difficulty,
        sets: options.sets,
        gamesPerSet,
        randomFactor: options.randomFactor,
        sprt: sprtConfig,
      },
      totalGames: completedGames,
      wdl,
      eloDiff: eloDiffResult,
      sprt: sprtState,
      games,
      elapsedSeconds,
      performanceStats,
    };

    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    const timestamp = benchResult.timestamp.replace(/[:.]/g, "-");
    const outputPath = path.join(OUTPUT_DIR, `commit-bench-${timestamp}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(benchResult, null, 2));
    console.log(`\n結果を保存: ${outputPath}`);
  } finally {
    cleanup();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
