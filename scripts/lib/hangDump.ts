/**
 * ハングダンプ JSON の Single Source of Truth。
 *
 * `commit-bench.ts`（書き込み側）と `scripts/replay-hang.ts`（読み込み側）が
 * 独立に手書き定義していたため型が食い違いはじめた（board が unknown vs
 * BoardState 等）。両者ともこのファイルから型と writeHangDump をインポートする。
 *
 * ダンプは commit-bench の bench-results/hang-dumps/hang-*.json に保存され、
 * 後日 replay-hang スクリプトで局面再現に使う。schemaVersion 変更時は
 * replay-hang.ts の後方互換ロジックを同時に更新すること。
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { EvaluationOptions } from "../../src/logic/cpu/evaluation/patternScores.ts";
import type { BoardState } from "../../src/types/game.ts";
import type { HangContext, MoveRecord } from "../commit-game-runner.ts";
import type { CommitInfo } from "../types/commit-bench.ts";

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

/** ハング時の状態スナップショット */
export interface HangDumpHang {
  /** ハングした側（A/B）— この情報だけで worker 側の worktree/config を引ける */
  side: "A" | "B";
  color: "black" | "white";
  requestId: number;
  timeoutMs: number;
  elapsedMs: number;
  /** 何手目でハングしたか（1-based, opening 3手を含む） */
  moveNumber: number;
}

/** ハングした側の worker 設定（replay 用の完全情報） */
export interface HangDumpWorker {
  side: "A" | "B";
  worktreePath: string;
  commit: CommitInfo;
  difficulty: string;
  randomFactor: number | undefined;
  evaluationOptions: Partial<EvaluationOptions> | undefined;
  bookEnabled: boolean;
  color: "black" | "white";
}

/** 相手側の worker 設定（対戦再構築が必要な将来のため） */
export interface HangDumpOpponent {
  side: "A" | "B";
  worktreePath: string;
  commit: CommitInfo;
  evaluationOptions: Partial<EvaluationOptions> | undefined;
  bookEnabled: boolean;
}

/** ダンプ JSON の全体スキーマ */
export interface HangDumpJson {
  type: "hang-dump";
  schemaVersion: 1;
  timestamp: string;
  bench: HangDumpBench;
  match: HangDumpMatch;
  hang: HangDumpHang;
  worker: HangDumpWorker;
  opponent: HangDumpOpponent;
  /** ハング直前の盤面（そのままリクエストとして送れる形） */
  board: BoardState;
  /** ハング直前までの着手履歴（opening 3手を含む。row/col/isOpening/time…） */
  moveHistory: MoveRecord[];
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

  const dump: HangDumpJson = {
    type: "hang-dump",
    schemaVersion: 1,
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

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const iso = dump.timestamp.replace(/[:.]/g, "-");
  const outPath = path.join(outputDir, `hang-${iso}-g${match.gameIdx}.json`);
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
  return outPath;
}
