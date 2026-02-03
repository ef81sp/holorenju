/**
 * Move Ordering（候補手ソート）
 *
 * Alpha-Beta剪定の効率向上のため、候補手を優先度順にソート。
 * Killer Moves、History Heuristic、静的評価を組み合わせて効果的な順序を決定。
 */

import type { BoardState, Position, StoneColor } from "@/types/game";

import { BOARD_SIZE } from "@/constants";

import {
  DEFAULT_EVAL_OPTIONS,
  evaluatePosition,
  type EvaluationOptions,
} from "./evaluation";

// =============================================================================
// Killer Moves
// =============================================================================

/** Killer Movesの最大保持数（各深さごと） */
const MAX_KILLER_MOVES = 2;

/** 最大探索深度（Killer Moves用） */
const MAX_DEPTH = 10;

/**
 * Killer Moves構造体
 *
 * 同じ深さでBeta cutoffを引き起こした手を記録。
 * 同じ深さの他の局面でも有効な可能性が高い。
 */
export interface KillerMoves {
  /** [depth][index] => Position */
  moves: (Position | null)[][];
}

/**
 * Killer Movesを初期化
 */
export function createKillerMoves(): KillerMoves {
  const moves: (Position | null)[][] = [];
  for (let d = 0; d < MAX_DEPTH; d++) {
    moves[d] = new Array(MAX_KILLER_MOVES).fill(null) as (Position | null)[];
  }
  return { moves };
}

/**
 * Killer Moveを記録
 *
 * @param killers Killer Moves構造体
 * @param depth 探索深度
 * @param move Beta cutoffを引き起こした手
 */
export function recordKillerMove(
  killers: KillerMoves,
  depth: number,
  move: Position,
): void {
  if (depth >= MAX_DEPTH) {
    return;
  }

  const depthMoves = killers.moves[depth];
  if (!depthMoves) {
    return;
  }

  // 既に記録されている場合はスキップ
  for (const km of depthMoves) {
    if (km && km.row === move.row && km.col === move.col) {
      return;
    }
  }

  // 新しい手を先頭に追加（古い手は後ろにシフト）
  for (let i = MAX_KILLER_MOVES - 1; i > 0; i--) {
    depthMoves[i] = depthMoves[i - 1] ?? null;
  }
  depthMoves[0] = move;
}

/**
 * 指定深度のKiller Movesを取得
 */
export function getKillerMoves(
  killers: KillerMoves,
  depth: number,
): Position[] {
  if (depth >= MAX_DEPTH) {
    return [];
  }

  const depthMoves = killers.moves[depth];
  if (!depthMoves) {
    return [];
  }

  return depthMoves.filter((m): m is Position => m !== null);
}

// =============================================================================
// History Heuristic
// =============================================================================

/**
 * History Table
 *
 * 過去の探索でcutoffを引き起こした手の統計を保持。
 * [row][col] => スコア（cutoffを引き起こすほど高い）
 */
export type HistoryTable = number[][];

/**
 * History Tableを初期化
 */
export function createHistoryTable(): HistoryTable {
  const table: HistoryTable = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    table[row] = new Array(BOARD_SIZE).fill(0) as number[];
  }
  return table;
}

/**
 * History Tableを更新
 *
 * @param history History Table
 * @param move cutoffを引き起こした手
 * @param depth 探索深度（深いほど重要）
 */
export function updateHistory(
  history: HistoryTable,
  move: Position,
  depth: number,
): void {
  const row = history[move.row];
  if (row) {
    // depth^2でスコアを増加（深い探索でのcutoffほど重要）
    row[move.col] = (row[move.col] ?? 0) + depth * depth;
  }
}

/**
 * History Tableからスコアを取得
 */
export function getHistoryScore(history: HistoryTable, move: Position): number {
  return history[move.row]?.[move.col] ?? 0;
}

/**
 * History Tableをクリア
 */
export function clearHistoryTable(history: HistoryTable): void {
  for (let row = 0; row < BOARD_SIZE; row++) {
    const r = history[row];
    if (r) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        r[col] = 0;
      }
    }
  }
}

// =============================================================================
// Move Ordering（候補手ソート）
// =============================================================================

/**
 * ソートオプション
 */
export interface MoveOrderingOptions {
  /** TT最善手（最優先） */
  ttMove?: Position | null;
  /** Killer Moves */
  killers?: KillerMoves;
  /** 現在の探索深度（Killer用） */
  depth?: number;
  /** History Table */
  history?: HistoryTable;
  /** 静的評価を使用するか */
  useStaticEval?: boolean;
  /** 評価オプション（重い機能の有効/無効） */
  evaluationOptions?: EvaluationOptions;
  /** 静的評価を実行する最大候補数（Lazy Evaluation用、デフォルト: 全て） */
  maxStaticEvalCount?: number;
}

/**
 * 候補手をソート
 *
 * 優先度（降順）:
 * 1. TT最善手 - 置換表に記録された最善手
 * 2. Killer Moves - 同じ深さで剪定を引き起こした手
 * 3. 静的評価 - evaluatePosition()による攻撃・防御価値（Lazy Evaluation対応）
 * 4. History Heuristic - 過去に剪定を引き起こした手の統計
 *
 * Lazy Evaluation:
 * maxStaticEvalCountが指定された場合、TT最善手・Killer・Historyで事前ソートし、
 * 上位N手のみ静的評価を実行することで高速化する。
 *
 * @param moves 候補手配列
 * @param board 盤面
 * @param color 手番
 * @param options ソートオプション
 * @returns ソート済み候補手配列
 */
export function sortMoves(
  moves: Position[],
  board: BoardState,
  color: StoneColor,
  options: MoveOrderingOptions = {},
): Position[] {
  const {
    ttMove,
    killers,
    depth,
    history,
    useStaticEval = true,
    evaluationOptions = DEFAULT_EVAL_OPTIONS,
    maxStaticEvalCount,
  } = options;

  // スコア計算用の配列
  interface MoveWithScore {
    move: Position;
    score: number;
    staticEvalDone: boolean;
  }
  const scoredMoves: MoveWithScore[] = [];

  // Killer Movesを取得
  const killerMoves =
    killers && depth !== undefined ? getKillerMoves(killers, depth) : [];

  // === 第1パス: TT最善手 + Killer Moves + History でスコア付け ===
  for (const move of moves) {
    let score = 0;

    // 1. TT最善手 - 最高優先度
    if (ttMove && move.row === ttMove.row && move.col === ttMove.col) {
      score += 1000000;
    }

    // 2. Killer Moves
    for (let i = 0; i < killerMoves.length; i++) {
      const km = killerMoves[i];
      if (km && move.row === km.row && move.col === km.col) {
        // 最初のKiller Moveほど高スコア
        score += 100000 - i * 10000;
        break;
      }
    }

    // 4. History Heuristic（静的評価より先に適用）
    if (history) {
      score += getHistoryScore(history, move);
    }

    scoredMoves.push({ move, score, staticEvalDone: false });
  }

  // === Lazy Evaluation: 上位N手のみ静的評価 ===
  if (useStaticEval && color !== null) {
    const evalCount = maxStaticEvalCount ?? scoredMoves.length;

    if (evalCount < scoredMoves.length) {
      // Lazy Evaluation: 事前ソートして上位N手のみ評価
      scoredMoves.sort((a, b) => b.score - a.score);

      for (let i = 0; i < Math.min(evalCount, scoredMoves.length); i++) {
        const sm = scoredMoves[i];
        if (sm) {
          sm.score += evaluatePosition(
            board,
            sm.move.row,
            sm.move.col,
            color,
            evaluationOptions,
          );
          sm.staticEvalDone = true;
        }
      }
    } else {
      // 全候補手を評価（従来の動作）
      for (const sm of scoredMoves) {
        sm.score += evaluatePosition(
          board,
          sm.move.row,
          sm.move.col,
          color,
          evaluationOptions,
        );
        sm.staticEvalDone = true;
      }
    }
  }

  // スコア降順でソート（再ソート）
  scoredMoves.sort((a, b) => b.score - a.score);

  // -Infinityの手を除外（必須防御ルールで除外された手）
  const validMoves = scoredMoves.filter((sm) => sm.score > -Infinity);

  // 有効な手がなければ全ての手を返す（やむを得ない場合）
  if (validMoves.length === 0) {
    return scoredMoves.map((sm) => sm.move);
  }

  return validMoves.map((sm) => sm.move);
}
