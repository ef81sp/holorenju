/**
 * 探索コンテキスト管理
 *
 * Minimax探索で使用するデータ構造を一元管理
 */

import { DEFAULT_EVAL_OPTIONS, type EvaluationOptions } from "../evaluation";
import {
  createHistoryTable,
  createKillerMoves,
  type HistoryTable,
  type KillerMoves,
} from "../moveGenerator";
import { globalTT, TranspositionTable } from "../transpositionTable";

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
  /** 探索統計 */
  stats: SearchStats;
  /** 評価オプション */
  evaluationOptions: EvaluationOptions;
  /** 探索開始時刻（時間制限用） */
  startTime?: number;
  /** 時間制限（ミリ秒） */
  timeLimit?: number;
  /** 時間切れフラグ */
  timeoutFlag?: boolean;
  /** ノード数上限 */
  maxNodes?: number;
  /** ノード数上限超過フラグ */
  nodeCountExceeded?: boolean;
  /** 絶対時間制限（ミリ秒）- これを超えたら強制終了 */
  absoluteTimeLimit?: number;
  /** 絶対時間制限超過フラグ */
  absoluteTimeLimitExceeded?: boolean;
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
    stats: {
      nodes: 0,
      ttHits: 0,
      ttCutoffs: 0,
      betaCutoffs: 0,
    },
    evaluationOptions,
  };
}
