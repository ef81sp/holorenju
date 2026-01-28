/**
 * CPU対戦関連の型定義
 */

import type { BoardState, Position, StoneColor } from "./game";

/**
 * CPU難易度
 */
export type CpuDifficulty = "beginner" | "easy" | "medium" | "hard";

/**
 * 有効な難易度の配列
 */
export const CPU_DIFFICULTIES: readonly CpuDifficulty[] = [
  "beginner",
  "easy",
  "medium",
  "hard",
] as const;

/**
 * 文字列がCpuDifficultyかどうかを判定
 */
export function isCpuDifficulty(value: string): value is CpuDifficulty {
  return CPU_DIFFICULTIES.includes(value as CpuDifficulty);
}

/**
 * 難易度パラメータ
 */
export interface DifficultyParams {
  /** 探索深度 */
  depth: number;
  /** 時間制限（ミリ秒） */
  timeLimit: number;
  /** ランダム要素（0-1、0で完全決定論的） */
  randomFactor: number;
}

/**
 * 難易度ごとのパラメータ設定
 */
export const DIFFICULTY_PARAMS: Record<CpuDifficulty, DifficultyParams> = {
  beginner: {
    depth: 2,
    timeLimit: 1000,
    randomFactor: 0.3,
  },
  easy: {
    depth: 3,
    timeLimit: 2000,
    randomFactor: 0.15,
  },
  medium: {
    depth: 4,
    timeLimit: 3000,
    randomFactor: 0,
  },
  hard: {
    depth: 5,
    timeLimit: 5000,
    randomFactor: 0,
  },
};

/**
 * AI着手リクエスト（Worker通信用）
 */
export interface AIRequest {
  /** 現在の盤面 */
  board: BoardState;
  /** 現在の手番 */
  currentTurn: StoneColor;
  /** 難易度 */
  difficulty: CpuDifficulty;
}

/**
 * AI着手レスポンス（Worker通信用）
 */
export interface AIResponse {
  /** 着手位置 */
  position: Position;
  /** 評価スコア */
  score: number;
  /** 思考時間（ミリ秒） */
  thinkingTime: number;
  /** 探索深度 */
  depth: number;
}

/**
 * 対戦結果
 */
export type BattleResult = "win" | "lose" | "draw";

/**
 * 対戦記録
 */
export interface CpuBattleRecord {
  /** 記録ID */
  id: string;
  /** タイムスタンプ */
  timestamp: number;
  /** 難易度 */
  difficulty: CpuDifficulty;
  /** プレイヤーが先手かどうか */
  playerFirst: boolean;
  /** 結果 */
  result: BattleResult;
  /** 手数 */
  moves: number;
}

/**
 * 難易度別統計
 */
export interface CpuBattleStats {
  /** 難易度 */
  difficulty: CpuDifficulty;
  /** 勝利数 */
  wins: number;
  /** 敗北数 */
  losses: number;
  /** 引き分け数 */
  draws: number;
  /** 総対局数 */
  totalGames: number;
  /** 勝率 */
  winRate: number;
}
