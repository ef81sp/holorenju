/**
 * CPU対戦関連の型定義
 */

import type { EvaluationOptions } from "@/logic/cpuAI/evaluation";

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
  /** ノード数上限（探索の打ち切り条件） */
  maxNodes: number;
  /** 評価オプション（重い機能の有効/無効） */
  evaluationOptions: EvaluationOptions;
}

/**
 * 難易度ごとのパラメータ設定
 *
 * 評価オプション:
 * - beginner/easy: 全機能無効（高速モード）
 * - medium: ミセ手・複数方向脅威・カウンターフォー有効
 * - hard: 全機能有効（VCT含む）
 */
export const DIFFICULTY_PARAMS: Record<CpuDifficulty, DifficultyParams> = {
  beginner: {
    depth: 2,
    timeLimit: 1000,
    randomFactor: 0.3,
    maxNodes: 10000,
    evaluationOptions: {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: false,
      enableSingleFourPenalty: false,
      enableMiseThreat: false,
    },
  },
  easy: {
    depth: 3,
    timeLimit: 2000,
    randomFactor: 0.25,
    maxNodes: 50000,
    evaluationOptions: {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: true,
      enableSingleFourPenalty: false,
      enableMiseThreat: false,
    },
  },
  medium: {
    depth: 5,
    timeLimit: 3000,
    randomFactor: 0,
    maxNodes: 200000,
    evaluationOptions: {
      enableFukumi: true,
      enableMise: true,
      enableForbiddenTrap: false,
      enableMultiThreat: true,
      enableCounterFour: true,
      enableVCT: false,
      enableMandatoryDefense: true,
      enableSingleFourPenalty: true,
      enableMiseThreat: true,
    },
  },
  hard: {
    depth: 5,
    timeLimit: 5000,
    randomFactor: 0,
    maxNodes: 500000,
    evaluationOptions: {
      enableFukumi: true,
      enableMise: true,
      enableForbiddenTrap: true,
      enableMultiThreat: true,
      enableCounterFour: true,
      enableVCT: true,
      enableMandatoryDefense: true,
      enableSingleFourPenalty: true,
      enableMiseThreat: true,
    },
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
 * パターンスコア詳細（斜めボーナス・倍率表示用）
 */
export interface PatternScoreDetail {
  /** 基本スコア（斜めボーナス適用前の合計） */
  base: number;
  /** 斜めボーナス分 */
  diagonalBonus: number;
  /** 最終スコア（base + diagonalBonus、倍率適用後） */
  final: number;
  /** 倍率適用前の値（防御の0.5倍前など） */
  preMultiplier?: number;
  /** 適用された倍率（0.5など） */
  multiplier?: number;
}

/**
 * パターン内訳（デバッグ表示用）
 */
export interface PatternBreakdown {
  /** 五連 */
  five: PatternScoreDetail;
  /** 活四（両端開） */
  openFour: PatternScoreDetail;
  /** 止め四（片端開） */
  four: PatternScoreDetail;
  /** 活三（両端開） */
  openThree: PatternScoreDetail;
  /** 止め三（片端開） */
  three: PatternScoreDetail;
  /** 活二 */
  openTwo: PatternScoreDetail;
  /** 止め二 */
  two: PatternScoreDetail;
}

/**
 * スコア内訳（デバッグ表示用）
 */
export interface ScoreBreakdown {
  /** 攻撃パターン内訳 */
  pattern: PatternBreakdown;
  /** 防御パターン内訳（相手のパターンを阻止） */
  defense: PatternBreakdown;
  /** 四三ボーナス */
  fourThree: number;
  /** フクミ手ボーナス */
  fukumi: number;
  /** ミセ手ボーナス */
  mise: number;
  /** 中央ボーナス */
  center: number;
  /** 複数方向脅威ボーナス */
  multiThreat: number;
}

/**
 * 候補手情報（デバッグ表示用）
 */
export interface CandidateMove {
  /** 着手位置 */
  position: Position;
  /** 評価スコア */
  score: number;
  /** 順位（1始まり） */
  rank: number;
  /** スコア内訳 */
  breakdown?: ScoreBreakdown;
}

/**
 * ランダム選択情報（デバッグ表示用）
 */
export interface RandomSelectionInfo {
  /** ランダム選択が発生したか */
  wasRandom: boolean;
  /** 選択された手の元の順位（1始まり） */
  originalRank: number;
  /** 選択対象の候補数 */
  candidateCount: number;
  /** 設定されたランダム係数 */
  randomFactor: number;
}

/**
 * 深度別の最善手情報（デバッグ表示用）
 */
export interface DepthResult {
  /** 探索深度 */
  depth: number;
  /** 最善手の位置 */
  position: Position;
  /** 評価スコア */
  score: number;
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
  /** 候補手リスト（デバッグ用、上位5手） */
  candidates?: CandidateMove[];
  /** ランダム選択情報（デバッグ用） */
  randomSelection?: RandomSelectionInfo;
  /** 深度別の最善手履歴（デバッグ用） */
  depthHistory?: DepthResult[];
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
