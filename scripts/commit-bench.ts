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
 *
 * Gate 2（評価基底の対決）: --eval-options-a / --eval-options-b で A/B 側それぞれに
 * evaluationOptions（JSON、EvaluationOptions の部分オブジェクト）を注入できる。
 * commitA と commitB を同一コミットに指定すれば、同一 worktree 内で基底違いのみを
 * 比較できる（例: A=prospect / B=legacy）:
 *   pnpm commit:bench --commitA=HEAD --commitB=HEAD --sets=1 \
 *     --eval-options-a='{"evalBasis":"prospect"}'
 * 省略時（--eval-options-a/b 未指定）は従来どおり legacy 同士（挙動不変）。
 *
 * worktree 内（.git がファイル=gitlink）からの実行にも対応: WORKTREES_DIR は
 * `git rev-parse --git-common-dir` で解決した「実 git ディレクトリ」（= 常に
 * メインリポジトリ側の .git）配下に置く。そのため **WORKTREES_DIR は全 worktree
 * 間で共有**であり、既存の「commit-bench の複数プロセス同時起動は不可（worktree
 * パスが競合）」制約は維持される（どの worktree から実行しても衝突しうる）。
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type { EvaluationOptions } from "../src/logic/cpu/evaluation/patternScores.ts";
import type { CpuDifficulty } from "../src/types/cpu.ts";
import type { HangContext } from "./commit-game-runner.ts";
import type { SPRTConfig } from "./types/ab.ts";
import type {
  CommitBenchResult,
  CommitGameResult,
  CommitInfo,
  PlayerPerformanceStats,
} from "./types/commit-bench.ts";

import { estimateEloDiff, formatEloDiff } from "./lib/eloDiff.ts";
import {
  buildJushuTasks,
  createBridgeWorker,
  gamesPerSet as computeGamesPerSet,
  type HangMatchInfo,
  runMatch,
} from "./lib/match.ts";
import { DEFAULT_SPRT_CONFIG, formatSPRT, updateSPRT } from "./lib/sprt.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "bench-results");

/**
 * 実 git ディレクトリ（.git-common-dir）を解決する。
 *
 * `.git` は通常リポジトリでは実ディレクトリだが、linked worktree（`git worktree add`
 * で作られた worktree）では「gitdir: <実パス>」を指すテキストファイル（gitlink）。
 * `path.join(PROJECT_ROOT, ".git", "worktrees-bench")` は後者で ENOTDIR になり
 * worktree 内から commit-bench を実行できなかった。`git rev-parse --git-common-dir`
 * は worktree 間で共有される実 git ディレクトリ（常にメインリポジトリ側 .git）を
 * 返すため、これを使えば通常リポジトリ・linked worktree のどちらでも正しく解決できる
 * （通常リポジトリでは相対パス ".git" が返るため PROJECT_ROOT 基準で絶対化する）。
 */
function resolveGitCommonDir(): string {
  try {
    const out = execSync("git rev-parse --git-common-dir", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    }).trim();
    return path.isAbsolute(out) ? out : path.resolve(PROJECT_ROOT, out);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: git ディレクトリの解決に失敗しました: ${msg}`);
    process.exit(1);
  }
}

const WORKTREES_DIR = path.join(resolveGitCommonDir(), "worktrees-bench");
const HANG_DUMPS_DIR = path.join(OUTPUT_DIR, "hang-dumps");

/**
 * HANG_INJECT=<gameIdx>:<requestOrdinal>[:A|B] を parse する。
 * - gameIdx: 0-based の tasks 配列上の局番号
 * - requestOrdinal: 1-based の非オープニング要求番号（その局で N 番目の要求でハング）
 * - オプション A|B: 対象 side を絞る（省略時はその手番の side を対象）
 * 不正な値なら process.exit(1)。
 */
function parseHangInjectEnv(
  raw: string | undefined,
): { gameIdx: number; requestOrdinal: number; side?: "A" | "B" } | null {
  if (raw === undefined || raw === "") {
    return null;
  }
  const parts = raw.split(":");
  if (parts.length !== 2 && parts.length !== 3) {
    console.error(
      `Error: HANG_INJECT は "<gameIdx>:<requestOrdinal>[:A|B]" の形式で指定してください (got: ${raw})`,
    );
    process.exit(1);
  }
  const gameIdx = parseInt(parts[0]!, 10);
  const requestOrdinal = parseInt(parts[1]!, 10);
  if (!Number.isFinite(gameIdx) || gameIdx < 0) {
    console.error(`Error: HANG_INJECT gameIdx が不正 (got: ${parts[0]})`);
    process.exit(1);
  }
  if (!Number.isFinite(requestOrdinal) || requestOrdinal < 1) {
    console.error(
      `Error: HANG_INJECT requestOrdinal は 1 以上の整数 (got: ${parts[1]})`,
    );
    process.exit(1);
  }
  const sideRaw = parts.length === 3 ? parts[2]! : undefined;
  if (sideRaw !== undefined && sideRaw !== "A" && sideRaw !== "B") {
    console.error(`Error: HANG_INJECT side は A か B (got: ${sideRaw})`);
    process.exit(1);
  }
  return {
    gameIdx,
    requestOrdinal,
    side: sideRaw as "A" | "B" | undefined,
  };
}

// ============================================================================
// ハングダンプ書き出し
// ============================================================================

interface HangDumpSideConfig {
  worktreePath: string;
  evaluationOptions: Partial<EvaluationOptions> | undefined;
  bookEnabled: boolean;
  commit: CommitInfo;
}

interface HangDumpJson {
  type: "hang-dump";
  schemaVersion: 1;
  timestamp: string;
  bench: {
    /** 発生元スクリプト。replay がどの構成を組めばよいか区別するため */
    tool: "commit-bench";
    difficulty: string;
    randomFactor: number | undefined;
    moveTimeoutMs: number;
  };
  match: {
    gameIdx: number;
    jushuName: string;
    isABlack: boolean;
    pairIdx: number;
  };
  hang: {
    /** ハングした側（A/B）— この情報だけで worker 側の worktree/config を引ける */
    side: "A" | "B";
    color: "black" | "white";
    requestId: number;
    timeoutMs: number;
    elapsedMs: number;
    /** 何手目でハングしたか（1-based, opening 3手を含む） */
    moveNumber: number;
  };
  /** ハングした側の worker 設定（replay 用の完全情報） */
  worker: {
    side: "A" | "B";
    worktreePath: string;
    commit: CommitInfo;
    difficulty: string;
    randomFactor: number | undefined;
    evaluationOptions: Partial<EvaluationOptions> | undefined;
    bookEnabled: boolean;
    color: "black" | "white";
  };
  /** 相手側の worker 設定（対戦の再構築が必要な将来のため） */
  opponent: {
    side: "A" | "B";
    worktreePath: string;
    commit: CommitInfo;
    evaluationOptions: Partial<EvaluationOptions> | undefined;
    bookEnabled: boolean;
  };
  /** ハング直前の盤面（そのままリクエストとして送れる形） */
  board: unknown;
  /** ハング直前までの着手履歴（opening 3手を含む。row/col/isOpening/time…） */
  moveHistory: unknown;
}

function writeHangDump(params: {
  context: HangContext;
  info: HangMatchInfo;
  commonConfig: { difficulty: string; randomFactor: number | undefined };
  workerConfigs: { A: HangDumpSideConfig; B: HangDumpSideConfig };
}): void {
  const { context, info, commonConfig, workerConfigs } = params;
  const hangSide = context.side;
  const oppSide: "A" | "B" = hangSide === "A" ? "B" : "A";
  const hangCfg = workerConfigs[hangSide];
  const oppCfg = workerConfigs[oppSide];

  const dump: HangDumpJson = {
    type: "hang-dump",
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    bench: {
      tool: "commit-bench",
      difficulty: commonConfig.difficulty,
      randomFactor: commonConfig.randomFactor,
      moveTimeoutMs: context.timeoutMs,
    },
    match: {
      gameIdx: info.gameIdx,
      jushuName: info.jushuName,
      isABlack: info.isABlack,
      pairIdx: info.pairIdx,
    },
    hang: {
      side: context.side,
      color: context.color,
      requestId: context.requestId,
      timeoutMs: context.timeoutMs,
      elapsedMs: context.elapsedMs,
      moveNumber: context.moveNumber,
    },
    worker: {
      side: hangSide,
      worktreePath: hangCfg.worktreePath,
      commit: hangCfg.commit,
      difficulty: commonConfig.difficulty,
      randomFactor: commonConfig.randomFactor,
      evaluationOptions: hangCfg.evaluationOptions,
      bookEnabled: hangCfg.bookEnabled,
      color: context.color,
    },
    opponent: {
      side: oppSide,
      worktreePath: oppCfg.worktreePath,
      commit: oppCfg.commit,
      evaluationOptions: oppCfg.evaluationOptions,
      bookEnabled: oppCfg.bookEnabled,
    },
    board: context.board,
    moveHistory: context.moveHistory,
  };

  if (!fs.existsSync(HANG_DUMPS_DIR)) {
    fs.mkdirSync(HANG_DUMPS_DIR, { recursive: true });
  }
  const iso = dump.timestamp.replace(/[:.]/g, "-");
  const outPath = path.join(
    HANG_DUMPS_DIR,
    `hang-${iso}-g${info.gameIdx}.json`,
  );
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
  console.warn(`⚠ hang detected g${info.gameIdx}, dumped to ${outPath}`);
}

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
  jobs: number;
  /** Gate 2: A/B 側それぞれの evaluationOptions オーバーライド（例: evalBasis=prospect）。 */
  evalOptionsA?: Partial<EvaluationOptions>;
  evalOptionsB?: Partial<EvaluationOptions>;
  /**
   * オープニングブック（opening-book-2026-07-16.md ★v2プラン B3）を A/B 側それぞれで
   * 有効化するか。既定 OFF（両側とも従来どおり探索のみ、後方互換）。
   * B3仕様③: 同一バイナリで book-ON/OFF をフラグ切替できる構成を優先する
   * （--commitA=HEAD --commitB=HEAD --book-a で単一 worktree のまま比較できる）。
   */
  bookA: boolean;
  bookB: boolean;
  /**
   * デバッグ/スモークテスト用: タスクを先頭 N 局に切り詰める（0 なら無効）。
   * ハング計装の e2e 検証で少局数（例: 4局）を回すために追加。
   * 通常のベンチ運用では 0（無効＝全 sets を消化）。
   */
  maxGames: number;
  /**
   * ハングした側 worker の 1 手あたりタイムアウト（ms）。
   * 通常は 30000 で運用。ハング計装のテスト時は短くして待ち時間を減らす。
   */
  moveTimeoutMs: number;
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
    jobs: 1,
    bookA: false,
    bookB: false,
    maxGames: 0,
    moveTimeoutMs: 30000,
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
    } else if (arg.startsWith("--jobs=")) {
      const value = parseInt(arg.slice("--jobs=".length), 10);
      if (!isNaN(value) && value > 0) {
        options.jobs = value;
      }
    } else if (arg.startsWith("--eval-options-a=")) {
      options.evalOptionsA = parseEvalOptionsJson(
        arg.slice("--eval-options-a=".length),
        "--eval-options-a",
      );
    } else if (arg.startsWith("--eval-options-b=")) {
      options.evalOptionsB = parseEvalOptionsJson(
        arg.slice("--eval-options-b=".length),
        "--eval-options-b",
      );
    } else if (arg === "--book-a") {
      options.bookA = true;
    } else if (arg === "--book-b") {
      options.bookB = true;
    } else if (arg.startsWith("--max-games=")) {
      const value = parseInt(arg.slice("--max-games=".length), 10);
      if (!isNaN(value) && value >= 0) {
        options.maxGames = value;
      } else {
        console.error(
          `Error: --max-games は 0 以上の整数で指定 (got: ${arg.slice("--max-games=".length)})`,
        );
        process.exit(1);
      }
    } else if (arg.startsWith("--move-timeout-ms=")) {
      const value = parseInt(arg.slice("--move-timeout-ms=".length), 10);
      if (!isNaN(value) && value > 0) {
        options.moveTimeoutMs = value;
      } else {
        console.error(
          `Error: --move-timeout-ms は正の整数で指定 (got: ${arg.slice("--move-timeout-ms=".length)})`,
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

/**
 * --eval-options-a / --eval-options-b の JSON 文字列をパースする。
 * EvaluationOptions の部分オブジェクト（evalBasis 等の string enum を含む）を
 * そのまま受け取れる（ab-bench の --eval-option は boolean/number 専用でこの用途に
 * 使えないため、こちらは JSON 一発指定にしている）。
 */
function parseJsonOrExit(str: string, flagName: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    console.error(
      `Error: ${flagName} は正しいJSON文字列で指定してください (got: ${str})`,
    );
    process.exit(1);
  }
}

function parseEvalOptionsJson(
  str: string,
  flagName: string,
): Partial<EvaluationOptions> {
  const parsed = parseJsonOrExit(str, flagName);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.error(
      `Error: ${flagName} はJSONオブジェクトで指定してください (got: ${str})`,
    );
    process.exit(1);
  }
  return parsed as Partial<EvaluationOptions>;
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
  --jobs=<n>             同時対局数（worker ペア組数, default: 1）。ターン制なので
                         1ゲーム≈1コア。8コアなら6前後が目安
  --eval-options-a=<json> A側 evaluationOptions オーバーライド（JSON。例: '{"evalBasis":"prospect"}'）
  --eval-options-b=<json> B側 evaluationOptions オーバーライド（JSON。省略時は legacy 既定）
  --book-a               A側でオープニングブックを有効化（既定OFF）
  --book-b               B側でオープニングブックを有効化（既定OFF）
  --max-games=<n>        タスクを先頭 N 局に切り詰め（0=無効, default: 0）。
                         ハング計装のスモークテスト用
  --move-timeout-ms=<n>  1手あたりのタイムアウト (default: 30000)
  --verbose, -v          詳細ログ
  --help, -h             ヘルプを表示

環境変数:
  HANG_INJECT=<gameIdx>:<requestOrdinal>[:A|B]
      指定 gameIdx の局で N 番目の非オープニング要求にハングを注入
      （bridge worker が応答しなくなる）。ハング検出→ダンプ→worker 再生成の
      回復パスを実際に発火させるテスト用。

Examples:
  pnpm commit:bench --commitA=HEAD~1 --commitB=HEAD --sets=1
  pnpm commit:bench --commitA=abc1234 --commitB=def5678 --sprt --elo0=0 --elo1=30

  # Gate 2: 同一コミット内で evalBasis=prospect vs legacy を対決させる
  pnpm commit:bench --commitA=HEAD --commitB=HEAD --sets=8 --randomFactor=0.02 \\
    --eval-options-a='{"evalBasis":"prospect"}'

  # ブックゲート: 同一コミット内で book-ON vs book-OFF を対決させる
  # （B3仕様③: コミット差の交絡を排除、worktree1本で済む）
  pnpm commit:bench --commitA=HEAD --commitB=HEAD --sets=8 --randomFactor=0.02 \\
    --book-a

  # ハング計装スモークテスト（4局・jobs=2・5秒タイムアウト・g1 の 2 手目で注入）
  HANG_INJECT=1:2 pnpm commit:bench --commitA=HEAD --commitB=HEAD \\
    --difficulty=easy --max-games=4 --jobs=2 --move-timeout-ms=5000
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

interface AggregatedSearchStats {
  nodes: number;
  ttHits: number;
  ttCutoffs: number;
  betaCutoffs: number;
  nullMoveTrials: number;
  nullMoveCutoffs: number;
  futilityPrunes: number;
  threatExtensions: number;
  lmrTrials: number;
  lmrResearches: number;
  qSearchNodes: number;
  threatProbeCutoffs: number;
  totalTime: number;
}

function aggregateSearchStats(
  games: CommitGameResult[],
  isPlayerA: boolean,
): AggregatedSearchStats | null {
  const acc: AggregatedSearchStats = {
    nodes: 0,
    ttHits: 0,
    ttCutoffs: 0,
    betaCutoffs: 0,
    nullMoveTrials: 0,
    nullMoveCutoffs: 0,
    futilityPrunes: 0,
    threatExtensions: 0,
    lmrTrials: 0,
    lmrResearches: 0,
    qSearchNodes: 0,
    threatProbeCutoffs: 0,
    totalTime: 0,
  };
  let hasStats = false;

  for (const game of games) {
    for (let i = 0; i < game.moveHistory.length; i++) {
      const move = game.moveHistory[i]!;
      if (move.isOpening) {
        continue;
      }
      const isBlackMove = i % 2 === 0;
      const isA =
        (isBlackMove && game.isABlack) || (!isBlackMove && !game.isABlack);
      if (isA !== isPlayerA) {
        continue;
      }

      const s = move.stats as Record<string, number> | undefined;
      if (!s) {
        continue;
      }
      hasStats = true;
      acc.nodes += s.nodes ?? 0;
      acc.ttHits += s.ttHits ?? 0;
      acc.ttCutoffs += s.ttCutoffs ?? 0;
      acc.betaCutoffs += s.betaCutoffs ?? 0;
      acc.nullMoveTrials += s.nullMoveTrials ?? 0;
      acc.nullMoveCutoffs += s.nullMoveCutoffs ?? 0;
      acc.futilityPrunes += s.futilityPrunes ?? 0;
      acc.threatExtensions += s.threatExtensions ?? 0;
      acc.lmrTrials += s.lmrTrials ?? 0;
      acc.lmrResearches += s.lmrResearches ?? 0;
      acc.qSearchNodes += s.qSearchNodes ?? 0;
      acc.threatProbeCutoffs += s.threatProbeCutoffs ?? 0;
      acc.totalTime += move.time;
    }
  }

  return hasStats ? acc : null;
}

// ============================================================================
// ステータス表示
// ============================================================================

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

  const gamesPerSet = computeGamesPerSet(); // 全珠型 × 2色
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
  if (options.evalOptionsA || options.evalOptionsB) {
    console.log(
      `evalOptions A: ${options.evalOptionsA ? JSON.stringify(options.evalOptionsA) : "(既定=legacy)"}`,
    );
    console.log(
      `evalOptions B: ${options.evalOptionsB ? JSON.stringify(options.evalOptionsB) : "(既定=legacy)"}`,
    );
  }
  if (options.bookA || options.bookB) {
    console.log(`book A: ${options.bookA ? "ON" : "OFF"}`);
    console.log(`book B: ${options.bookB ? "ON" : "OFF"}`);
  }
  if (sprtConfig) {
    console.log(
      `SPRT: elo0=${sprtConfig.elo0}, elo1=${sprtConfig.elo1}, ` +
        `alpha=${sprtConfig.alpha}, beta=${sprtConfig.beta}`,
    );
  }
  console.log();

  let worktreePathA: string | null = null;
  let worktreePathB: string | null = null;
  // 並列実行用の worker ペア群（各ペア = A/B の bridge worker）。
  // ゲームはターン制で実質1コアしか使わないため、ペアを複数組にして同時対局し
  // 遊休コアを活用する（worktree の wasm は read-only なので複数 worker から共有可）。
  const pairs: { a: Worker; b: Worker }[] = [];

  // クリーンアップ関数
  const cleanup = (): void => {
    for (const pair of pairs) {
      pair.a.terminate();
      pair.b.terminate();
    }
    pairs.length = 0;
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

    // bridge workerを起動（--jobs 組のペアを並列初期化）
    const workerPath = path.join(__dirname, "cpu-bridge-worker.ts");
    const makeWorker = (
      worktreePath: string,
      evaluationOptions: Partial<EvaluationOptions> | undefined,
      bookEnabled: boolean,
    ): Promise<Worker> =>
      createBridgeWorker({
        workerPath,
        loaderPath: path.join(worktreePath, "scripts", "register-loader.mjs"),
        worktreePath,
        difficulty: options.difficulty,
        randomFactor: options.randomFactor,
        evaluationOptions,
        bookEnabled,
      });

    console.log(`Bridge workerを初期化中... (${options.jobs}並列)`);
    const createdPairs = await Promise.all(
      Array.from({ length: options.jobs }, async () => {
        const [a, b] = await Promise.all([
          makeWorker(worktreePathA!, options.evalOptionsA, options.bookA),
          makeWorker(worktreePathB!, options.evalOptionsB, options.bookB),
        ]);
        return { a, b };
      }),
    );
    pairs.push(...createdPairs);
    console.log("Bridge worker初期化完了\n");

    // 珠型タスクを生成し、共有の対局ループ（runMatch）で消化する。
    //
    // ハング耐性: move-request timeout（GameHangError）が起きたら、当該局を破棄しつつ
    // 再現ダンプ（bench-results/hang-dumps/hang-*.json）を書き、当該 pair の worker を
    // 再生成して残り局を続行する。プロセス全体を落とさない。
    const allTasks = buildJushuTasks(options.sets);
    const tasks =
      options.maxGames > 0 && options.maxGames < allTasks.length
        ? allTasks.slice(0, options.maxGames)
        : allTasks;
    if (options.maxGames > 0 && options.maxGames < allTasks.length) {
      console.log(
        `--max-games=${options.maxGames} 指定により ${allTasks.length}→${tasks.length} 局に切り詰め`,
      );
    }

    // ダンプ用の side メタ（worker 再生成にも再利用）
    const workerConfigs = {
      A: {
        worktreePath: worktreePathA!,
        evaluationOptions: options.evalOptionsA,
        bookEnabled: options.bookA,
        commit: commitA,
      },
      B: {
        worktreePath: worktreePathB!,
        evaluationOptions: options.evalOptionsB,
        bookEnabled: options.bookB,
        commit: commitB,
      },
    } as const;

    const recreatePair = async (
      idx: number,
    ): Promise<{ a: Worker; b: Worker }> => {
      const [a, b] = await Promise.all([
        makeWorker(worktreePathA!, options.evalOptionsA, options.bookA),
        makeWorker(worktreePathB!, options.evalOptionsB, options.bookB),
      ]);
      const fresh = { a, b };
      pairs[idx] = fresh;
      return fresh;
    };

    const onHang = (context: HangContext, info: HangMatchInfo): void => {
      writeHangDump({
        context,
        info,
        commonConfig: {
          difficulty: options.difficulty,
          randomFactor: options.randomFactor,
        },
        workerConfigs,
      });
    };

    const hangInjectEnv = parseHangInjectEnv(process.env.HANG_INJECT);
    if (hangInjectEnv) {
      console.log(
        `⚠ HANG_INJECT 有効: gameIdx=${hangInjectEnv.gameIdx} requestOrdinal=${hangInjectEnv.requestOrdinal}${hangInjectEnv.side ? ` side=${hangInjectEnv.side}` : ""}`,
      );
    }

    const { wdl, games, completedGames, aborts } = await runMatch({
      pairs,
      tasks,
      totalGames: tasks.length,
      sprtConfig,
      moveTimeoutMs: options.moveTimeoutMs,
      verbose: options.verbose,
      startTime,
      recreatePair,
      onHang,
      hangInject: hangInjectEnv
        ? {
            gameIdx: hangInjectEnv.gameIdx,
            spec: {
              requestOrdinal: hangInjectEnv.requestOrdinal,
              side: hangInjectEnv.side,
            },
          }
        : undefined,
    });

    const elapsedSeconds = (performance.now() - startTime) / 1000;

    // 結果表示
    console.log(`\n=== 結果 ===`);
    console.log(`commitA: ${commitA.shortSha} "${commitA.message}"`);
    console.log(`commitB: ${commitB.shortSha} "${commitB.message}"`);
    console.log(
      `対局数: ${completedGames}${aborts > 0 ? ` (abort: ${aborts})` : ""}`,
    );
    if (aborts > 0) {
      console.log(
        `⚠ ハング検出: ${aborts} 局を破棄しました。ダンプは ${HANG_DUMPS_DIR} を参照`,
      );
    }
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

    // A/Bごとの探索統計を集計・表示
    const searchStatsA = aggregateSearchStats(games, true);
    const searchStatsB = aggregateSearchStats(games, false);
    if (searchStatsA || searchStatsB) {
      console.log(`\n--- 探索統計 ---`);
      for (const [label, ss] of [
        ["A", searchStatsA],
        ["B", searchStatsB],
      ] as const) {
        if (!ss) {
          continue;
        }
        const nps =
          ss.totalTime > 0 ? Math.round((ss.nodes / ss.totalTime) * 1000) : 0;
        console.log(
          `  ${label}: nodes=${ss.nodes} NPS=${nps} ttHit=${ss.ttHits} ttCut=${ss.ttCutoffs} betaCut=${ss.betaCutoffs} qNodes=${ss.qSearchNodes} threatCut=${ss.threatProbeCutoffs} lmr=${ss.lmrTrials}(re:${ss.lmrResearches}) nmp=${ss.nullMoveTrials}(cut:${ss.nullMoveCutoffs}) futility=${ss.futilityPrunes}`,
        );
      }
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
        evalOptionsA: options.evalOptionsA,
        evalOptionsB: options.evalOptionsB,
        bookA: options.bookA,
        bookB: options.bookB,
      },
      totalGames: completedGames,
      aborts,
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
