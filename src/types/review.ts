/**
 * 振り返り（棋譜評価）関連の型定義
 */

import type { LeafEvaluation, ScoreBreakdown } from "./cpu";
import type { Position } from "./game";

/**
 * 候補手（内訳付き）
 */
export interface ReviewCandidate {
  position: Position;
  /** 即時評価スコア */
  score: number;
  /** 探索スコア（順位の根拠） */
  searchScore: number;
  /** 即時評価の内訳 */
  breakdown?: ScoreBreakdown;
  /** 予想手順 */
  principalVariation?: Position[];
  /** 探索末端の評価内訳 */
  leafEvaluation?: LeafEvaluation;
}

/**
 * 手の品質分類
 */
export type MoveQuality =
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

/**
 * 1手分の評価結果
 */
export interface EvaluatedMove {
  /** 手番インデックス（0始まり） */
  moveIndex: number;
  /** 着手位置 */
  position: Position;
  /** プレイヤーの手かどうか */
  isPlayerMove: boolean;
  /** 品質 */
  quality: MoveQuality;
  /** 実際の手のスコア */
  playedScore: number;
  /** 最善手のスコア */
  bestScore: number;
  /** スコア差 */
  scoreDiff: number;
  /** 最善手の位置 */
  bestMove: Position;
  /** 上位候補手 */
  candidates: ReviewCandidate[];
  /** 探索が完了した深度 */
  completedDepth?: number;
  /** 必勝手順の種類 */
  forcedWinType?: "vcf" | "vct" | "forbidden-trap" | "mise-vcf";
}

/**
 * 対局全体の評価結果
 */
export interface GameReview {
  /** 各手の評価 */
  evaluatedMoves: EvaluatedMove[];
  /** プレイヤー精度（0-100） */
  accuracy: number;
  /** クリティカルエラー数（mistake + blunder） */
  criticalErrors: number;
}

/**
 * 評価Workerへのリクエスト
 */
export interface ReviewEvalRequest {
  /** 棋譜文字列 */
  moveHistory: string;
  /** 評価する手のインデックス */
  moveIndex: number;
  /** プレイヤーが先手かどうか */
  playerFirst: boolean;
}

/**
 * 評価Workerの結果（1手分）
 */
export interface ReviewWorkerResult {
  /** 手のインデックス */
  moveIndex: number;
  /** 最善手 */
  bestMove: Position;
  /** 最善手のスコア */
  bestScore: number;
  /** 実際の手のスコア */
  playedScore: number;
  /** 上位候補手 */
  candidates: ReviewCandidate[];
  /** 探索が完了した深度 */
  completedDepth: number;
  /** 必勝手順の種類 */
  forcedWinType?: "vcf" | "vct" | "forbidden-trap" | "mise-vcf";
}
