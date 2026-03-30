/**
 * 探索コンテキスト管理
 *
 * Minimax探索で使用するデータ構造を一元管理。
 * VCF/VCT共通の時間制限コンテキストもここで定義。
 */

import type { Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";

import type { LineTable } from "../lineTable/lineTable";
import type { ProfilingCounters } from "../profiling/counters";
import type { BoardEvaluator } from "../wasm/bridge";

import {
  DEFAULT_EVAL_OPTIONS,
  type EvaluationOptions,
} from "../evaluation/patternScores";
import {
  createHistoryTable,
  createKillerMoves,
  type HistoryTable,
  type KillerMoves,
} from "../moveGenerator";
import { globalTT, TranspositionTable } from "../transpositionTable";
import { createThreatProbeCache, type ThreatProbeCache } from "./threatProbe";

// =============================================================================
// Counter-move Table
// =============================================================================

/**
 * Counter-move テーブル
 *
 * [row][col] => Position | null
 * 「相手がこの位置に打った後のベスト応手」を記録。
 * 連珠では各マスに一度しか石を置けないため、色別にする必要なし。
 */
export type CounterMoveTable = (Position | null)[][];

/**
 * Counter-move テーブルを初期化
 */
export function createCounterMoveTable(): CounterMoveTable {
  return Array.from({ length: BOARD_SIZE }, () =>
    new Array<Position | null>(BOARD_SIZE).fill(null),
  );
}

/**
 * VCF/VCT共通の時間制限コンテキスト
 */
export interface TimeLimiter {
  startTime: number;
  timeLimit: number;
  /** 探索ノード数カウンタ（maxNodes と併用） */
  nodes?: number;
  /** ノード数上限（0 = 無制限） */
  maxNodes?: number;
  /** 親リミッター（VCT→VCF連携用: ノード数を親にも伝播し、親の制限も検査する） */
  parentLimiter?: TimeLimiter;
}

/**
 * 時間制限またはノード数上限を超過しているかチェック
 *
 * parentLimiter が設定されている場合、親の制限も検査する。
 */
export function isTimeExceeded(limiter: TimeLimiter): boolean {
  if (
    limiter.maxNodes !== undefined &&
    limiter.maxNodes > 0 &&
    limiter.nodes !== undefined &&
    limiter.nodes >= limiter.maxNodes
  ) {
    return true;
  }
  if (performance.now() - limiter.startTime >= limiter.timeLimit) {
    return true;
  }
  if (limiter.parentLimiter) {
    return isTimeExceeded(limiter.parentLimiter);
  }
  return false;
}

/**
 * ノードカウンタをインクリメント
 *
 * parentLimiter が設定されている場合、親のノード数もインクリメントする。
 */
export function incrementNodes(limiter: TimeLimiter): void {
  if (limiter.nodes !== undefined) {
    limiter.nodes++;
  }
  if (limiter.parentLimiter) {
    incrementNodes(limiter.parentLimiter);
  }
}

/**
 * 探索統計
 */
export interface SearchStats {
  /** 探索ノード数 */
  nodes: number;
  /** TTヒット数 */
  ttHits: number;
  /** TTカットオフ数 */
  ttCutoffs: number;
  /** Beta剪定数 */
  betaCutoffs: number;
  /** 禁手判定回数 */
  forbiddenCheckCalls: number;
  /** 盤面コピー回数 */
  boardCopies: number;
  /** 脅威検出回数 */
  threatDetectionCalls: number;
  /** 評価関数呼び出し回数 */
  evaluationCalls: number;
  /** Null Move Pruning 試行回数（hasImmediateThreat呼び出し回数） */
  nullMoveTrials: number;
  /** Null Move Pruning によるカットオフ数 */
  nullMoveCutoffs: number;
  /** Futility Pruning によるスキップ数 */
  futilityPrunes: number;
  /** Threat Extension 発動回数 */
  threatExtensions: number;
  /** LMR 発動回数 */
  lmrTrials: number;
  /** LMR re-search 発動回数 */
  lmrResearches: number;
  /** LMR moveIndex 分布 [3, 4, 5+] */
  lmrMoveIndexDist: [number, number, number];
  /** QSearch ノード数 */
  qSearchNodes: number;
  /** QSearch 分岐数の合計（平均計算用） */
  qSearchBranchSum: number;
  /** QSearch エントリ数（平均分岐計算用） */
  qSearchEntries: number;
  /** QSearch 深度の合計（平均深度計算用） */
  qSearchDepthSum: number;
  /** QSearch 終端数（平均深度計算用） */
  qSearchLeaves: number;
  /** 関数別タイミング（プロファイリング有効時のみ） */
  timings?: ProfilingCounters["timings"];
}

/**
 * 探索コンテキスト
 *
 * 探索中に使用するデータ構造を一元管理
 */
export interface SearchContext {
  /** Transposition Table */
  tt: TranspositionTable;
  /** History Table */
  history: HistoryTable;
  /** Killer Moves */
  killers: KillerMoves;
  /** Counter-move Table */
  counterMoves: CounterMoveTable;
  /** 探索統計 */
  stats: SearchStats;
  /** 評価オプション */
  evaluationOptions: EvaluationOptions;
  /** ビットマスク版ラインテーブル */
  lineTable?: LineTable;
  /** 探索停止タイムスタンプ（deadline ベース） */
  deadline?: number;
  /** 時間切れフラグ */
  timeoutFlag?: boolean;
  /** ノード数上限 */
  maxNodes?: number;
  /** ノード数上限超過フラグ */
  nodeCountExceeded?: boolean;
  /** 絶対停止タイムスタンプ（deadline ベース） */
  absoluteDeadline?: number;
  /** 絶対時間制限超過フラグ */
  absoluteDeadlineExceeded?: boolean;
  /** 脅威プローブキャッシュ（minimax内VCF/VCTチェック用） */
  threatCache: ThreatProbeCache;
  /** 振り返りパス: performance.now() 依存を排除し決定論的に動作 */
  noTimeLimit?: boolean;
  /** 盤面評価関数（WASM/TS切り替え） */
  boardEvaluator?: BoardEvaluator;
}

/**
 * SearchContextを作成
 */
export function createSearchContext(
  tt: TranspositionTable = globalTT,
  evaluationOptions: EvaluationOptions = DEFAULT_EVAL_OPTIONS,
): SearchContext {
  return {
    tt,
    history: createHistoryTable(),
    killers: createKillerMoves(),
    counterMoves: createCounterMoveTable(),
    stats: {
      nodes: 0,
      ttHits: 0,
      ttCutoffs: 0,
      betaCutoffs: 0,
      forbiddenCheckCalls: 0,
      boardCopies: 0,
      threatDetectionCalls: 0,
      evaluationCalls: 0,
      nullMoveTrials: 0,
      nullMoveCutoffs: 0,
      futilityPrunes: 0,
      threatExtensions: 0,
      lmrTrials: 0,
      lmrResearches: 0,
      lmrMoveIndexDist: [0, 0, 0],
      qSearchNodes: 0,
      qSearchBranchSum: 0,
      qSearchEntries: 0,
      qSearchDepthSum: 0,
      qSearchLeaves: 0,
    },
    evaluationOptions,
    threatCache: createThreatProbeCache(),
  };
}
