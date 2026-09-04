/**
 * ハングダンプ JSON の Single Source of Truth。
 *
 * `commit-bench.ts`（書き込み側）と `scripts/replay-hang.ts`（読み込み側）が
 * 独立に手書き定義していたため型が食い違いはじめた（board が unknown vs
 * BoardState 等）。両者ともこのファイルから型と writeHangDump をインポートする。
 *
 * ダンプは commit-bench の bench-results/hang-dumps/hang-*.json に保存され、
 * 後日 replay-hang スクリプトで局面再現に使う。ディスク上には旧版（v1）の
 * ダンプも残るため、型は schemaVersion による discriminated union にしてある。
 * schemaVersion を上げるときは replay-hang.ts の後方互換ロジックも同時に更新すること。
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { EvaluationOptions } from "../../src/logic/cpu/evaluation/patternScores.ts";
import type { BoardState } from "../../src/types/game.ts";
import type { HangContext, MoveRecord } from "../commit-game-runner.ts";
import type { CommitInfo } from "../types/commit-bench.ts";
import type { EventLoopSnapshot } from "./eventLoopSampler.ts";
import type { HangLiveness } from "./workerLiveness.ts";
import type {
  RecentGameRecord,
  WorkerTelemetrySnapshot,
} from "./workerTelemetry.ts";

/**
 * ダンプの現行スキーマ版。
 * - v1: PR #109 初版
 * - v2: #128 で worker.telemetry / recentGames / hang.liveness / hang.mainThread / notes を追加
 */
export const HANG_DUMP_SCHEMA_VERSION = 2;

/**
 * 「ハング中の worker から何が取れて何が取れないか」をダンプ自身に残す。
 * 調査者が毎回同じ問いを立て直さなくて済むようにする。
 */
export const HANG_DUMP_NOTES = [
  "worker はハング中もメッセージに応答できない（wasm 探索でスレッドが同期ブロックされ event loop が回らない）ため、" +
    "getStatsBuffer 等の『現在の探索統計』を問い合わせることはできない。" +
    "worker.telemetry.recentMoves（直前 N 手の nodes/depth/interrupted/time）で代替している。",
  "hang.liveness は SharedArrayBuffer 経由の生存信号。wasm は時間制限判定のたびに JS の " +
    "getTimestampMsExternal を呼び返すので、その呼び出し回数が進んでいれば『探索が走り続けている』、" +
    "止まっていれば『探索ループの外で固まっている』と切り分けられる（Zig 側は無改造）。",
  "hang.mainThread はメインスレッド自身のイベントループ遅延・時計ずれ。" +
    "timer lag が小さいのに elapsedMs だけが巨大なら、worker の探索ではなく " +
    "プロセス/マシンのサスペンドを疑う。",
];

/** ダンプに含める側（A/B）ごとの worker 設定 */
export interface HangDumpSideConfig {
  worktreePath: string;
  evaluationOptions: Partial<EvaluationOptions> | undefined;
  bookEnabled: boolean;
  commit: CommitInfo;
}

/** ダンプ発生源のベンチ側情報 */
export interface HangDumpBench {
  /** 発生元スクリプト。replay がどの構成を組めばよいか区別するため */
  tool: "commit-bench";
  difficulty: string;
  randomFactor: number | undefined;
  moveTimeoutMs: number;
  /** ハング当時の --jobs 値（並列ペア数。過負荷起因かの事後判断用） */
  jobs?: number;
  /**
   * ハング当時の baseSeed（--seed CLI で指定した値）。指定なしなら undefined。
   * 実効的な perGameSeed は match.gameSeed に別途保存する。
   */
  baseSeed?: number;
}

/** ダンプに含める対局メタ */
export interface HangDumpMatch {
  gameIdx: number;
  jushuName: string;
  isABlack: boolean;
  pairIdx: number;
  /**
   * この局に注入された PRNG seed（baseSeed と gameIdx から導出）。
   * 指定 seed なしなら undefined。replay 時にこれを worker に渡せば
   * randomFactor 起因のばらつきを再現できる。
   */
  gameSeed?: number;
}

/** ハング時の状態スナップショット（v1 共通部） */
export interface HangDumpHangBase {
  /** ハングした側（A/B）— この情報だけで worker 側の worktree/config を引ける */
  side: "A" | "B";
  color: "black" | "white";
  requestId: number;
  timeoutMs: number;
  elapsedMs: number;
  /** 何手目でハングしたか（1-based, 開局手を含む） */
  moveNumber: number;
}

/** v2 のハング情報（生存信号とメインスレッド健康状態を追加） */
export interface HangDumpHangV2 extends HangDumpHangBase {
  /** 共有メモリ経由の worker 生存信号（#128） */
  liveness: HangLiveness;
  /**
   * メインスレッドのイベントループ遅延・時計ずれ。
   * 「worker がハングした」のか「メインスレッドが止まっていた」のかを切り分ける。
   */
  mainThread: EventLoopSnapshot;
}

/** ハングした側の worker 設定（replay 用の完全情報） */
export interface HangDumpWorkerBase {
  side: "A" | "B";
  worktreePath: string;
  commit: CommitInfo;
  difficulty: string;
  randomFactor: number | undefined;
  evaluationOptions: Partial<EvaluationOptions> | undefined;
  bookEnabled: boolean;
  color: "black" | "white";
}

/** v2 の worker 情報（メインスレッドが保持していた計測を追加） */
export interface HangDumpWorkerV2 extends HangDumpWorkerBase {
  /**
   * メインスレッドが保持していた worker 計測のスナップショット。
   * 起動時の解決済みパラメータ・起動からの要求数・ハングした要求（moveSeed 含む）・
   * 直近 N 手の思考統計・同一 worker が打ち終えた直近 M 局を含む。
   */
  telemetry: WorkerTelemetrySnapshot;
}

/** 相手側の worker 設定（対戦再構築が必要な将来のため） */
export interface HangDumpOpponent {
  side: "A" | "B";
  worktreePath: string;
  commit: CommitInfo;
  evaluationOptions: Partial<EvaluationOptions> | undefined;
  bookEnabled: boolean;
}

/** v1/v2 で共通のフィールド */
interface HangDumpCommon {
  type: "hang-dump";
  timestamp: string;
  bench: HangDumpBench;
  match: HangDumpMatch;
  opponent: HangDumpOpponent;
  /** ハング直前の盤面（そのままリクエストとして送れる形） */
  board: BoardState;
  /** ハング直前までの着手履歴（開局手を含む。row/col/isOpening/time…） */
  moveHistory: MoveRecord[];
}

/** PR #109 初版のダンプ（ディスク上に残っている実データ 2 件がこれ） */
export interface HangDumpJsonV1 extends HangDumpCommon {
  schemaVersion: 1;
  hang: HangDumpHangBase;
  worker: HangDumpWorkerBase;
}

/** #128 で拡張したダンプ */
export interface HangDumpJsonV2 extends HangDumpCommon {
  schemaVersion: 2;
  hang: HangDumpHangV2;
  worker: HangDumpWorkerV2;
  /**
   * ハングした worker が同一インスタンスで直前に打ち終えた局（古→新）。
   * `worker.telemetry.recentGames` と同じ内容を、読み手が辿りやすいよう
   * トップレベルにも置く。`replay-hang --replay-history=N` の入力。
   */
  recentGames: RecentGameRecord[];
  /** 人間向けの注記（何が取れて何が取れないか） */
  notes: string[];
}

/** ダンプ JSON の全体スキーマ（版で分岐する discriminated union） */
export type HangDumpJson = HangDumpJsonV1 | HangDumpJsonV2;

/** v2 ダンプかを判定する型ガード。 */
export function isHangDumpV2(dump: HangDumpJson): dump is HangDumpJsonV2 {
  return dump.schemaVersion === 2;
}

export interface WriteHangDumpParams {
  outputDir: string;
  context: HangContext;
  match: HangDumpMatch;
  bench: HangDumpBench;
  workerConfigs: { A: HangDumpSideConfig; B: HangDumpSideConfig };
}

/** 呼び出し側は match/bench の中身を組み立てて渡す。書き込んだ絶対パスを返す。 */
export function writeHangDump(params: WriteHangDumpParams): string {
  const { outputDir, context, match, bench, workerConfigs } = params;
  const hangSide = context.side;
  const oppSide: "A" | "B" = hangSide === "A" ? "B" : "A";
  const hangCfg = workerConfigs[hangSide];
  const oppCfg = workerConfigs[oppSide];

  const dump: HangDumpJsonV2 = {
    type: "hang-dump",
    schemaVersion: HANG_DUMP_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    bench,
    match,
    hang: {
      side: context.side,
      color: context.color,
      requestId: context.requestId,
      timeoutMs: context.timeoutMs,
      elapsedMs: context.elapsedMs,
      moveNumber: context.moveNumber,
      liveness: context.liveness,
      mainThread: context.mainThread,
    },
    worker: {
      side: hangSide,
      worktreePath: hangCfg.worktreePath,
      commit: hangCfg.commit,
      difficulty: bench.difficulty,
      randomFactor: bench.randomFactor,
      evaluationOptions: hangCfg.evaluationOptions,
      bookEnabled: hangCfg.bookEnabled,
      color: context.color,
      telemetry: context.telemetry,
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
    recentGames: context.telemetry.recentGames,
    notes: HANG_DUMP_NOTES,
  };

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const iso = dump.timestamp.replace(/[:.]/g, "-");
  const outPath = path.join(outputDir, `hang-${iso}-g${match.gameIdx}.json`);
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
  return outPath;
}
