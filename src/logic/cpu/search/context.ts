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
  /** 禁手判定回数 */
  forbiddenCheckCalls: number;
  /** 盤面コピー回数 */
  boardCopies: number;
  /** 脅威検出回数 */
  threatDetectionCalls: number;
  /** 評価関数呼び出し回数 */
  evaluationCalls: number;
  /** Null Move Pruning によるカットオフ数 */
  nullMoveCutoffs: number;
  /** Futility Pruning によるスキップ数 */
  futilityPrunes: number;
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
      forbiddenCheckCalls: 0,
      boardCopies: 0,
      threatDetectionCalls: 0,
      evaluationCalls: 0,
      nullMoveCutoffs: 0,
      futilityPrunes: 0,
    },
    evaluationOptions,
  };
}
