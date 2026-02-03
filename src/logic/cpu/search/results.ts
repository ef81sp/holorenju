/**
 * 探索結果の型定義とPV抽出
 *
 * Minimax探索の結果を表す型とPrincipal Variation抽出ロジック
 */

import type { BoardState, Position } from "@/types/game";

import { applyMove, getOppositeColor } from "../core/boardUtils";
import { TranspositionTable } from "../transpositionTable";
import { updateHash } from "../zobrist";

/**
 * 候補手のスコア情報
 */
export interface MoveScoreEntry {
  /** 着手位置 */
  move: Position;
  /** 評価スコア */
  score: number;
  /** Principal Variation（予想手順） */
  pv?: Position[];
  /** PV末端の盤面（評価内訳計算用） */
  pvLeafBoard?: BoardState;
  /** PV末端での手番（評価内訳計算用） */
  pvLeafColor?: "black" | "white";
}

/**
 * PV抽出結果
 */
export interface PVExtractionResult {
  /** Principal Variation（予想手順） */
  pv: Position[];
  /** PV末端の盤面 */
  leafBoard: BoardState;
  /** PV末端での手番 */
  leafColor: "black" | "white";
}

/**
 * ランダム選択情報
 */
export interface RandomSelectionResult {
  /** ランダム選択が発生したか */
  wasRandom: boolean;
  /** 選択された手の元の順位（1始まり） */
  originalRank: number;
  /** 選択対象の候補数 */
  candidateCount: number;
}

/**
 * Minimax探索結果
 */
export interface MinimaxResult {
  /** 最善手の位置 */
  position: Position;
  /** 評価スコア */
  score: number;
  /** 候補手のスコアリスト（ソート済み） */
  candidates?: MoveScoreEntry[];
  /** ランダム選択情報 */
  randomSelection?: RandomSelectionResult;
}

/**
 * 深度別の最善手情報
 */
export interface DepthHistoryEntry {
  /** 探索深度 */
  depth: number;
  /** 最善手の位置 */
  position: Position;
  /** 評価スコア */
  score: number;
}

/**
 * Iterative Deepening結果
 */
export interface IterativeDeepingResult extends MinimaxResult {
  /** 実際に完了した探索深度 */
  completedDepth: number;
  /** 時間切れで中断したか */
  interrupted: boolean;
  /** 経過時間（ミリ秒） */
  elapsedTime: number;
  /** 深度別の最善手履歴 */
  depthHistory?: DepthHistoryEntry[];
}

/**
 * TranspositionTableからPrincipal Variation（予想手順）を抽出
 *
 * TTに保存されたbestMoveを辿って、予想される手順を復元する
 *
 * @param board 現在の盤面
 * @param startHash 開始盤面のハッシュ
 * @param firstMove 最初の手（候補手）
 * @param color 最初の手番の色
 * @param tt TranspositionTable
 * @param maxLength 最大手数（デフォルト: 10）
 * @returns PV抽出結果（予想手順、末端盤面、末端での手番）
 */
export function extractPV(
  board: BoardState,
  startHash: bigint,
  firstMove: Position,
  color: "black" | "white",
  tt: TranspositionTable,
  maxLength = 10,
): PVExtractionResult {
  const pv: Position[] = [firstMove];
  let currentBoard = applyMove(board, firstMove, color);
  let currentHash = updateHash(startHash, firstMove.row, firstMove.col, color);
  let currentColor: "black" | "white" = getOppositeColor(color);

  // TTエントリを辿ってPVを復元
  for (let i = 1; i < maxLength; i++) {
    const entry = tt.probe(currentHash);
    if (!entry?.bestMove) {
      break;
    }

    const move = entry.bestMove;

    // 盤面の有効性チェック
    if (currentBoard[move.row]?.[move.col] !== null) {
      break;
    }

    pv.push(move);
    currentBoard = applyMove(currentBoard, move, currentColor);
    currentHash = updateHash(currentHash, move.row, move.col, currentColor);
    currentColor = getOppositeColor(currentColor);
  }

  return {
    pv,
    leafBoard: currentBoard,
    leafColor: currentColor,
  };
}
