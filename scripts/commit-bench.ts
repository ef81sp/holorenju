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

import {
  effectiveRandomFactor,
  normalizeMaxGames,
  resolveFixedNodesParams,
  resolveFixedNodesPerSide,
  resolveMoveTimeoutMs,
  validateFixedNodesFlags,
} from "./lib/benchCliChecks.ts";
import {
  computeBenchGameStats,
  formatBenchGameStats,
} from "./lib/benchGameStats.ts";
import { formatEloDiff } from "./lib/eloDiff.ts";
import { startEventLoopSampler } from "./lib/eventLoopSampler.ts";
import { type HangDumpSideConfig, writeHangDump } from "./lib/hangDump.ts";
import { deriveGameSeed } from "./lib/hangReplay.ts";
import {
  createBridgeWorker,
  type HangMatchInfo,
  runMatch,
} from "./lib/match.ts";
import { resolveOpenings } from "./lib/openingSuiteLoader.ts";
import { formatPairedStats } from "./lib/pairedStats.ts";
import { parseHangInjectEnv } from "./lib/parseHangInjectEnv.ts";
import { DEFAULT_SPRT_CONFIG, formatSPRT } from "./lib/sprt.ts";
import { describeLivenessVerdict } from "./lib/workerLiveness.ts";
import { getWorkerTelemetry } from "./lib/workerTelemetry.ts";

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

// HANG_INJECT 環境変数のパーサは scripts/lib/parseHangInjectEnv.ts に SSoT 化（テスト付き）。
// ハングダンプ書き出しの型定義と実装は scripts/lib/hangDump.ts に SSoT 化した
// （commit-bench と replay-hang で型定義が食い違うのを防ぐため）。

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
   * 脅威プローブトグル（探索レバー A/B）。true=既定 ON（従来挙動）、
   * false=無効化（--probe-off-a/b で false になる）。prospect 基底下で
   * probe OFF が Elo に転換するかを commit-bench で再検証するためのレバー。
   */
  probeEnabledA: boolean;
  probeEnabledB: boolean;
  /**
   * 探索の maxNodes オーバーライド（side 別）。未指定なら difficulty 既定を使う。
   * probe OFF/深さ探索レバーが maxNodes 早期打ち切りに拘束されるのを避け、
   * 「同じ持ち時間でノード上限が実質非拘束なら深読みが Elo に転換するか」を
   * 測るための CLI レバー。
   */
  maxNodesA?: number;
  maxNodesB?: number;
  /**
   * 探索の depth cap オーバーライド（side 別）。未指定なら difficulty 既定を使う。
   * probe OFF/深さレバーが depth cap で頭打ちになるのを避けるためのレバー。
   */
  maxDepthA?: number;
  maxDepthB?: number;
  /**
   * デバッグ/スモークテスト用: タスクを先頭 N 局に切り詰める（0 なら無効）。
   * ペア境界で切る（奇数は偶数に切り下げ）。ハング計装の e2e 検証で少局数
   * （例: 4局）を回すために追加。通常のベンチ運用では 0（無効＝全 sets を消化）。
   */
  maxGames: number;
  /**
   * 開局スイート JSON（bench-precision-2026-09-04.md §2.2）。相対パスはリポジトリ
   * ルート基準。未指定なら従来どおり 26 珠型（後方互換）。指定時 --sets は
   * スイートの周回数になる。--book-a/--book-b とは併用不可。
   */
  openings?: string;
  /** スイートの n 番目から使う（末尾で折り返さない）。既定 0 */
  openingOffset: number;
  /**
   * ハングした側 worker の 1 手あたりタイムアウト（ms）。
   * 通常は 30000 で運用。ハング計装のテスト時は短くして待ち時間を減らす。
   * 決定的モード（--fixed-nodes）では未指定時の既定が 600000 になる
   * （1 手時間が N と負荷に比例して伸び、abort が緊迫局面に偏ると Elo が歪むため）。
   */
  moveTimeoutMs: number;
  /** `--move-timeout-ms` が CLI で明示されたか（決定的モードの既定切替に使う） */
  moveTimeoutMsExplicit: boolean;
  /**
   * randomFactor > 0 での対局の PRNG シード（baseSeed）。指定時、局ごとの
   * 実効 seed は `mixSeed(baseSeed, gameIdx)` で導出され、同一 --seed なら
   * 同一棋譜になる。未指定なら `Date.now() | 0` を使う（従来と同じく非決定的）。
   */
  seed: number;
  /** `--seed` が CLI で明示されたか（決定的モードでは randomFactor>0 に必須） */
  seedExplicit: boolean;
  /**
   * 固定ノード（決定的探索）モード。bench-fixed-nodes-2026-09-06.md §2.5。
   * `--fixed-nodes=N` は両側、`--fixed-nodes-a/b=N` は片側（時間 vs 固定の混合＝較正用）。
   * 該当側は timeLimit=0 / maxNodes=N / setDeterministicMode(1) で走る。
   */
  fixedNodes?: number;
  fixedNodesA?: number;
  fixedNodesB?: number;
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
    probeEnabledA: true,
    probeEnabledB: true,
    maxGames: 0,
    openingOffset: 0,
    moveTimeoutMs: 30000,
    moveTimeoutMsExplicit: false,
    seed: Date.now() | 0,
    seedExplicit: false,
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
    } else if (arg === "--probe-off-a") {
      options.probeEnabledA = false;
    } else if (arg === "--probe-off-b") {
      options.probeEnabledB = false;
    } else if (arg.startsWith("--max-nodes-a=")) {
      const value = parseInt(arg.slice("--max-nodes-a=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        options.maxNodesA = value;
      } else {
        console.error(
          `Error: --max-nodes-a は正の整数で指定 (got: ${arg.slice("--max-nodes-a=".length)})`,
        );
        process.exit(1);
      }
    } else if (arg.startsWith("--max-nodes-b=")) {
      const value = parseInt(arg.slice("--max-nodes-b=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        options.maxNodesB = value;
      } else {
        console.error(
          `Error: --max-nodes-b は正の整数で指定 (got: ${arg.slice("--max-nodes-b=".length)})`,
        );
        process.exit(1);
      }
    } else if (arg.startsWith("--max-depth-a=")) {
      const value = parseInt(arg.slice("--max-depth-a=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        options.maxDepthA = value;
      } else {
        console.error(
          `Error: --max-depth-a は正の整数で指定 (got: ${arg.slice("--max-depth-a=".length)})`,
        );
        process.exit(1);
      }
    } else if (arg.startsWith("--max-depth-b=")) {
      const value = parseInt(arg.slice("--max-depth-b=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        options.maxDepthB = value;
      } else {
        console.error(
          `Error: --max-depth-b は正の整数で指定 (got: ${arg.slice("--max-depth-b=".length)})`,
        );
        process.exit(1);
      }
    } else if (arg.startsWith("--max-games=")) {
      const value = parseInt(arg.slice("--max-games=".length), 10);
      if (!isNaN(value) && value >= 0) {
        const norm = normalizeMaxGames(value);
        if (!norm.ok) {
          console.error(`Error: ${norm.error}`);
          process.exit(1);
        }
        if (norm.warning) {
          console.warn(`⚠ ${norm.warning}`);
        }
        options.maxGames = norm.maxGames;
      } else {
        console.error(
          `Error: --max-games は 0 以上の整数で指定 (got: ${arg.slice("--max-games=".length)})`,
        );
        process.exit(1);
      }
    } else if (arg.startsWith("--openings=")) {
      const value = arg.slice("--openings=".length);
      if (value.length === 0) {
        console.error("Error: --openings にはファイルパスを指定してください");
        process.exit(1);
      }
      options.openings = value;
    } else if (arg.startsWith("--opening-offset=")) {
      const raw = arg.slice("--opening-offset=".length);
      const value = parseInt(raw, 10);
      if (Number.isFinite(value) && value >= 0) {
        options.openingOffset = value;
      } else {
        console.error(
          `Error: --opening-offset は 0 以上の整数で指定 (got: ${raw})`,
        );
        process.exit(1);
      }
    } else if (arg.startsWith("--move-timeout-ms=")) {
      const value = parseInt(arg.slice("--move-timeout-ms=".length), 10);
      if (!isNaN(value) && value > 0) {
        options.moveTimeoutMs = value;
        options.moveTimeoutMsExplicit = true;
      } else {
        console.error(
          `Error: --move-timeout-ms は正の整数で指定 (got: ${arg.slice("--move-timeout-ms=".length)})`,
        );
        process.exit(1);
      }
    } else if (arg.startsWith("--seed=")) {
      const raw = arg.slice("--seed=".length);
      const value = parseInt(raw, 10);
      if (Number.isFinite(value)) {
        options.seed = value | 0;
        options.seedExplicit = true;
      } else {
        console.error(`Error: --seed は整数で指定 (got: ${raw})`);
        process.exit(1);
      }
    } else if (arg.startsWith("--fixed-nodes=")) {
      options.fixedNodes = parsePositiveIntOrExit(arg, "--fixed-nodes");
    } else if (arg.startsWith("--fixed-nodes-a=")) {
      options.fixedNodesA = parsePositiveIntOrExit(arg, "--fixed-nodes-a");
    } else if (arg.startsWith("--fixed-nodes-b=")) {
      options.fixedNodesB = parsePositiveIntOrExit(arg, "--fixed-nodes-b");
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

/** `--flag=<n>` の正の整数をパースする。不正なら exit(1)。 */
function parsePositiveIntOrExit(arg: string, flagName: string): number {
  const raw = arg.slice(flagName.length + 1);
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`Error: ${flagName} は正の整数で指定 (got: ${raw})`);
    process.exit(1);
  }
  return value;
}

function resolvePerSideOrExit(options: CliOptions): {
  a: number | undefined;
  b: number | undefined;
} {
  try {
    return resolveFixedNodesPerSide(options);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

/** 固定ノードモードの side 別 N（両側/片側の正規化 + 排他チェック）。 */
interface FixedNodesResolved {
  a: number | undefined;
  b: number | undefined;
  /** どちらかの側が決定的モードか */
  anyDeterministic: boolean;
}

function resolveFixedNodesOrExit(options: CliOptions): FixedNodesResolved {
  const perSide = resolvePerSideOrExit(options);
  const error = validateFixedNodesFlags({
    fixedNodesA: perSide.a,
    fixedNodesB: perSide.b,
    maxNodesA: options.maxNodesA,
    maxNodesB: options.maxNodesB,
    bookA: options.bookA,
    bookB: options.bookB,
    // 実効値（未指定なら difficulty 既定）。beginner 等は既定 > 0 なので seed が要る
    randomFactor: effectiveRandomFactor(
      options.randomFactor,
      options.difficulty,
    ),
    seedExplicit: options.seedExplicit,
    sets: options.sets,
  });
  if (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
  return {
    ...perSide,
    anyDeterministic: perSide.a !== undefined || perSide.b !== undefined,
  };
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
  --sets=<n>             セット数 (1セット = 26珠型 × 2色 = 52局, default: 1)。
                         --openings 指定時はスイートの周回数
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
  --probe-off-a          A側の脅威プローブを無効化（既定ON）。prospect 基底下で
                         深度向上が Elo に転換するか検証するレバー
  --probe-off-b          B側の脅威プローブを無効化（既定ON）
  --max-nodes-a=<n>      A側の maxNodes を上書き（既定=difficulty 既定）。
                         probe OFF/深さレバーが maxNodes 早期打ち切りに拘束される
                         のを避け、timeLimit ベースで測るためのレバー
  --max-nodes-b=<n>      B側の maxNodes を上書き（既定=difficulty 既定）
  --max-depth-a=<n>      A側の depth cap を上書き（既定=difficulty 既定）。
                         probe OFF で深読みが伸びるかを見るとき、depth cap が
                         binding だと差が出ないので併用する
  --max-depth-b=<n>      B側の depth cap を上書き（既定=difficulty 既定）
  --max-games=<n>        タスクを先頭 N 局に切り詰め（0=無効, default: 0）。
                         ペア境界で切る（奇数は偶数に切り下げ）。スモークテスト用
  --openings=<file>      開局スイート JSON（gen:opening-suite の成果物。相対パスは
                         リポジトリルート基準）。指定時は珠型の代わりにスイートの各
                         開局 × 2 色で対局し、--sets はスイートの周回数になる。
                         --book-a/--book-b とは併用不可
  --opening-offset=<n>   スイートの n 番目の開局から使う（末尾で折り返さない。
                         互いに素な部分集合での再現性検証用, default: 0）
  --fixed-nodes=<n>      両側を固定ノード（決定的探索）モードで走らせる:
                         timeLimit=0 / maxNodes=N / setDeterministicMode(1)。
                         結果が壁時計・負荷に依存せず、同一入力で棋譜・1 手ごとの
                         nodes・score が完全一致する。--max-nodes-a/b・--book-a/b と
                         併用不可。randomFactor>0 は --seed 必須、--sets>1 は
                         randomFactor 必須。abort が 1 件でも出ると valid:false・非0終了。
                         非対応 wasm（本 PR より前のコミット）は起動時に中止
  --fixed-nodes-a=<n>    A 側のみ固定ノード（時間 vs 固定の混合。較正用）
  --fixed-nodes-b=<n>    B 側のみ固定ノード
  --move-timeout-ms=<n>  1手あたりのタイムアウト (default: 30000、--fixed-nodes 時は 600000)
  --seed=<n>             randomFactor 使用時の PRNG baseSeed（integer）。
                         同一 seed なら同一棋譜を再現。default: Date.now()（非決定的）
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

  # 開局スイート（600 開局 × 2 色 = 1,200 局、randomFactor 無し）
  pnpm commit:bench --commitA=80f1c4f --commitB=f1bdc9a --jobs=5 \\
    --openings=scripts/data/opening-suite-v1.json
  # 後半 300 開局だけ（再現性検証）
  pnpm commit:bench --commitA=80f1c4f --commitB=f1bdc9a --jobs=5 \\
    --openings=scripts/data/opening-suite-v1.json --opening-offset=300

  # 固定ノード（決定的）: 同一コミットの決定性スモーク。2 回走らせて
  # pnpm bench:reanalyze --compare a.json b.json で完全一致を確認する
  pnpm commit:bench --commitA=HEAD --commitB=HEAD --fixed-nodes=50000 \\
    --openings=scripts/data/opening-suite-v1.json --max-games=40 --jobs=2

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

function resolveOpeningsOrExit(
  options: CliOptions,
): ReturnType<typeof resolveOpenings> {
  try {
    return resolveOpenings({
      openings: options.openings,
      openingOffset: options.openingOffset,
      sets: options.sets,
      maxGames: options.maxGames,
      bookA: options.bookA,
      bookB: options.bookB,
      randomFactor: options.randomFactor,
      rootDir: PROJECT_ROOT,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const options = parseArgs();
  const fixedNodes = resolveFixedNodesOrExit(options);
  const moveTimeoutMs = resolveMoveTimeoutMs(
    options.moveTimeoutMsExplicit ? options.moveTimeoutMs : undefined,
    fixedNodes.anyDeterministic,
    options.moveTimeoutMs,
  );
  const startTime = performance.now();
  // #128: メインスレッドのイベントループ遅延・時計ずれを常時サンプリングする。
  // 「worker がハングした」のか「メインスレッド/マシンが止まっていた」のかを
  // ハングダンプで切り分けるため（実ダンプ g172 の 38.7 分の空白）。
  startEventLoopSampler();

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

  // 開局の供給元（--openings ならスイート、未指定なら 26 珠型）とタスク列を解決する。
  // totalGames は tasks.length（--max-games 切り詰め後）が唯一の源。
  const resolved = resolveOpeningsOrExit(options);
  const { suite, tasks, totalGames, gamesPerSet } = resolved;

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
  for (const line of resolved.summaryLines) {
    console.log(line);
  }
  for (const w of resolved.warnings) {
    console.warn(`⚠ ${w}`);
  }
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
  if (!options.probeEnabledA || !options.probeEnabledB) {
    console.log(`threatProbe A: ${options.probeEnabledA ? "ON" : "OFF"}`);
    console.log(`threatProbe B: ${options.probeEnabledB ? "ON" : "OFF"}`);
  }
  if (options.maxNodesA !== undefined || options.maxNodesB !== undefined) {
    console.log(
      `maxNodes A: ${options.maxNodesA ?? "(既定=difficulty)"} / B: ${options.maxNodesB ?? "(既定=difficulty)"}`,
    );
  }
  if (options.maxDepthA !== undefined || options.maxDepthB !== undefined) {
    console.log(
      `maxDepth A: ${options.maxDepthA ?? "(既定=difficulty)"} / B: ${options.maxDepthB ?? "(既定=difficulty)"}`,
    );
  }
  if (fixedNodes.anyDeterministic) {
    console.log(
      `fixedNodes（決定的モード） A: ${fixedNodes.a ?? "(時間モード)"} / B: ${fixedNodes.b ?? "(時間モード)"} | move-timeout=${moveTimeoutMs}ms`,
    );
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
    // side 別の worker 生成設定（初期化と再生成で同じものを使う）
    const sideParams = {
      A: {
        worktreePath: worktreePathA!,
        evaluationOptions: options.evalOptionsA,
        bookEnabled: options.bookA,
        threatProbeEnabled: options.probeEnabledA,
        maxNodes: options.maxNodesA,
        maxDepth: options.maxDepthA,
        fixed: resolveFixedNodesParams(fixedNodes.a),
      },
      B: {
        worktreePath: worktreePathB!,
        evaluationOptions: options.evalOptionsB,
        bookEnabled: options.bookB,
        threatProbeEnabled: options.probeEnabledB,
        maxNodes: options.maxNodesB,
        maxDepth: options.maxDepthB,
        fixed: resolveFixedNodesParams(fixedNodes.b),
      },
    } as const;
    const makeWorker = (side: "A" | "B"): Promise<Worker> => {
      const sp = sideParams[side];
      return createBridgeWorker({
        workerPath,
        loaderPath: path.join(
          sp.worktreePath,
          "scripts",
          "register-loader.mjs",
        ),
        worktreePath: sp.worktreePath,
        difficulty: options.difficulty,
        randomFactor: options.randomFactor,
        evaluationOptions: sp.evaluationOptions,
        bookEnabled: sp.bookEnabled,
        threatProbeEnabled: sp.threatProbeEnabled,
        // 固定ノードモードでは fixedNodes が maxNodes を決める（--max-nodes との併用は排他済み）
        maxNodes: sp.fixed?.maxNodes ?? sp.maxNodes,
        maxDepth: sp.maxDepth,
        timeLimit: sp.fixed?.timeLimit,
        deterministic: sp.fixed?.deterministic,
      });
    };
    const makePair = async (): Promise<{ a: Worker; b: Worker }> => {
      const [a, b] = await Promise.all([makeWorker("A"), makeWorker("B")]);
      return { a, b };
    };

    console.log(`Bridge workerを初期化中... (${options.jobs}並列)`);
    const createdPairs = await Promise.all(
      Array.from({ length: options.jobs }, () => makePair()),
    );
    pairs.push(...createdPairs);
    console.log("Bridge worker初期化完了\n");

    // 両側の wasm getSearchFeatures() ビット（ready 通知に同梱）。結果 JSON の provenance
    const firstPair = pairs[0]!;
    const searchFeaturesA = getWorkerTelemetry(firstPair.a).snapshot()
      .engineParams?.searchFeatures;
    const searchFeaturesB = getWorkerTelemetry(firstPair.b).snapshot()
      .engineParams?.searchFeatures;
    if (fixedNodes.anyDeterministic) {
      console.log(
        `searchFeatures A=${searchFeaturesA ?? "n/a"} B=${searchFeaturesB ?? "n/a"}`,
      );
    }

    // タスク列（珠型 or 開局スイート）を共有の対局ループ（runMatch）で消化する。
    //
    // ハング耐性: move-request timeout（GameHangError）が起きたら、当該局を破棄しつつ
    // 再現ダンプ（bench-results/hang-dumps/hang-*.json）を書き、当該 pair の worker を
    // 再生成して残り局を続行する。プロセス全体を落とさない。

    // ダンプ用の side メタ（worker 再生成にも再利用）
    const workerConfigs: { A: HangDumpSideConfig; B: HangDumpSideConfig } = {
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
    };

    const recreatePair = async (
      idx: number,
    ): Promise<{ a: Worker; b: Worker }> => {
      const fresh = await makePair();
      pairs[idx] = fresh;
      return fresh;
    };

    // 実効 randomFactor > 0 なら seed を渡す（difficulty 既定の randomFactor も含む。
    // 未指定 = Math.random に落ちて決定性・再現性が壊れる）。同一シード同一棋譜の検証用にログ
    const seedInEffect =
      effectiveRandomFactor(options.randomFactor, options.difficulty) > 0
        ? options.seed
        : undefined;
    if (seedInEffect !== undefined) {
      console.log(
        `PRNG seed（baseSeed）: ${seedInEffect}${process.argv.some((a) => a.startsWith("--seed=")) ? "" : " (default = Date.now())"}`,
      );
    }

    const onHang = (context: HangContext, info: HangMatchInfo): void => {
      const dumpPath = writeHangDump({
        outputDir: HANG_DUMPS_DIR,
        context,
        match: {
          gameIdx: info.gameIdx,
          jushuName: info.jushuName,
          isABlack: info.isABlack,
          pairIdx: info.pairIdx,
          gameSeed: deriveGameSeed(seedInEffect, info.gameIdx),
        },
        bench: {
          tool: "commit-bench",
          difficulty: options.difficulty,
          randomFactor: options.randomFactor,
          moveTimeoutMs: context.timeoutMs,
          jobs: options.jobs,
          baseSeed: seedInEffect,
          fixedNodesA: fixedNodes.a,
          fixedNodesB: fixedNodes.b,
        },
        workerConfigs,
      });
      const { telemetry, liveness, mainThread } = context;
      console.warn(
        `⚠ hang detected g${info.gameIdx}, dumped to ${dumpPath}\n` +
          `  worker: requests=${telemetry.requestCount} recentMoves=${telemetry.recentMoves.length} recentGames=${telemetry.recentGames.length}\n` +
          `  liveness: ${describeLivenessVerdict(liveness, telemetry.engineParams?.deterministic)}\n` +
          `  mainThread: maxTimerLag=${mainThread.maxTimerLagMs}ms maxClockSkewJump=${mainThread.maxClockSkewJumpMs}ms`,
      );
    };

    const hangInjectParsed = parseHangInjectEnv(process.env.HANG_INJECT);
    if (hangInjectParsed.kind === "error") {
      console.error(`Error: ${hangInjectParsed.message}`);
      process.exit(1);
    }
    const hangInjectEnv = hangInjectParsed.value;
    if (hangInjectEnv) {
      console.log(
        `⚠ HANG_INJECT 有効: gameIdx=${hangInjectEnv.gameIdx} requestOrdinal=${hangInjectEnv.requestOrdinal}${hangInjectEnv.side ? ` side=${hangInjectEnv.side}` : ""}`,
      );
    }

    const {
      wdl,
      games,
      completedGames,
      aborts,
      abortsBySide,
      abortedGames,
      stats,
    } = await runMatch({
      pairs,
      tasks,
      totalGames,
      sprtConfig,
      moveTimeoutMs,
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
      // 実効 randomFactor が 0 なら getGameSeed を渡さない（seed は意味を持たない）
      getGameSeed:
        seedInEffect === undefined
          ? undefined
          : (gameIdx: number): number => deriveGameSeed(seedInEffect, gameIdx)!,
    });

    const elapsedSeconds = (performance.now() - startTime) / 1000;

    // 結果表示
    console.log(`\n=== 結果 ===`);
    console.log(`commitA: ${commitA.shortSha} "${commitA.message}"`);
    console.log(`commitB: ${commitB.shortSha} "${commitB.message}"`);
    if (suite) {
      console.log(
        `開局スイート: ${suite.file} (version ${suite.version}, offset=${options.openingOffset})`,
      );
    }
    console.log(
      `対局数: ${completedGames}${aborts > 0 ? ` (abort: ${aborts} = A側${abortsBySide.A} / B側${abortsBySide.B})` : ""}`,
    );
    if (aborts > 0) {
      console.log(
        `⚠ ハング検出: ${aborts} 局を破棄しました（A側=${abortsBySide.A} / B側=${abortsBySide.B}）。ダンプは ${HANG_DUMPS_DIR} を参照`,
      );
      // 一方向バイアス（劣勢側がハングして負けが消される）を検出しやすくする
      if (abortsBySide.A !== abortsBySide.B) {
        console.log(
          `  ※ side 別 abort 数が非対称です。「劣勢側だけ抜ける」バイアスの可能性を確認してください`,
        );
      }
    }
    console.log(`WDL (commitA視点): +${wdl.wins} =${wdl.draws} -${wdl.losses}`);

    // 三項（旧・1 局単位）とペア（新・pentanomial）を並記。停止判定はペア。
    console.log(`[三項] ${formatEloDiff(stats.trinomialElo)}`);
    if (stats.sprtTrinomial) {
      console.log(`(三項・参考) ${formatSPRT(stats.sprtTrinomial, wdl)}`);
    }
    console.log(`[ペア] ${formatPairedStats(stats.paired)}`);
    console.log(formatBenchGameStats(computeBenchGameStats(games)));

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
        openings: resolved.config,
        evalOptionsA: options.evalOptionsA,
        evalOptionsB: options.evalOptionsB,
        bookA: options.bookA,
        bookB: options.bookB,
        threatProbeA: options.probeEnabledA,
        threatProbeB: options.probeEnabledB,
        maxNodesA: options.maxNodesA,
        maxNodesB: options.maxNodesB,
        maxDepthA: options.maxDepthA,
        maxDepthB: options.maxDepthB,
        seed: seedInEffect,
        fixedNodes: options.fixedNodes,
        fixedNodesA: fixedNodes.a,
        fixedNodesB: fixedNodes.b,
        searchFeaturesA,
        searchFeaturesB,
      },
      totalGames: completedGames,
      aborts,
      abortsBySide,
      abortedGames,
      // 決定的モードの受け入れ条件は abort=0（abort が緊迫局面に偏ると Elo が歪む）。
      // 時間モードでは従来どおり記録しない（abort 局を除いて集計）。
      valid: fixedNodes.anyDeterministic ? aborts === 0 : undefined,
      wdl,
      eloDiff: stats.trinomialElo,
      sprt: stats.paired.sprt,
      sprtTrinomial: stats.sprtTrinomial,
      paired: stats.paired,
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

    if (benchResult.valid === false) {
      console.error(
        `\n✗ 決定的モードで abort が ${aborts} 件発生したため、この run は無効（valid:false）です:`,
      );
      for (const g of abortedGames) {
        console.error(
          `    g${g.gameIdx} ${g.openingId} (${g.isABlack ? "A黒" : "A白"}) side=${g.side ?? "?"}: ${g.reason}`,
        );
      }
      console.error(
        `  --move-timeout-ms を伸ばすか N を下げて再実行してください（受け入れ条件は abort=0）。`,
      );
      process.exitCode = 1;
    }
  } finally {
    cleanup();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
