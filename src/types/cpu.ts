/**
 * CPU対戦関連の型定義
 */

import type { EvaluationOptions } from "@/logic/cpu/evaluation";

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
  /** スコア閾値（ランダム選択時の許容スコア差） */
  scoreThreshold: number;
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
    depth: 1,
    timeLimit: 1000,
    randomFactor: 0.8, // 80%で悪手（さらに弱体化してeasyとの差を広げる）
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
      singleFourPenaltyMultiplier: 1.0, // ペナルティなし（初心者らしく四を打ちがち）
      enableMiseThreat: false,
    },
    scoreThreshold: 1200, // 広いスコア差まで悪手候補に
  },
  easy: {
    depth: 2,
    timeLimit: 2000,
    randomFactor: 0.35, // 35%で悪手（easyを強化してmediumとの差を縮める）
    maxNodes: 50000,
    evaluationOptions: {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: true, // 致命的ミスを減らす
      enableSingleFourPenalty: false,
      singleFourPenaltyMultiplier: 1.0, // ペナルティなし（四を打ちがち）
      enableMiseThreat: false,
    },
    scoreThreshold: 300, // easyを強化（mediumとの差を縮める）
  },
  medium: {
    depth: 3,
    timeLimit: 4000,
    randomFactor: 0.1, // 10%で悪手（medium-easy差を広げる）
    maxNodes: 200000,
    evaluationOptions: {
      enableFukumi: false, // 探索効率を優先
      enableMise: true,
      enableForbiddenTrap: false,
      enableMultiThreat: true,
      enableCounterFour: true,
      enableVCT: true,
      enableMandatoryDefense: true,
      enableSingleFourPenalty: true,
      singleFourPenaltyMultiplier: 0.3, // 70%減点に緩和（単独四にも価値を認める）
      enableMiseThreat: true,
    },
    scoreThreshold: 150, // より最善手寄りに（medium-easy差を広げる）
  },
  hard: {
    depth: 4,
    timeLimit: 8000,
    randomFactor: 0,
    maxNodes: 600000,
    evaluationOptions: {
      enableFukumi: true,
      enableMise: true,
      enableForbiddenTrap: true,
      enableMultiThreat: true,
      enableCounterFour: true,
      enableVCT: true,
      enableMandatoryDefense: true,
      enableSingleFourPenalty: true,
      singleFourPenaltyMultiplier: 0.0, // 100%減点（単独四は完全に無価値）
      enableMiseThreat: true,
    },
    scoreThreshold: 0, // 常に最善手（使用しない）
  },
};

/**
 * CPU着手リクエスト（Worker通信用）
 */
export interface CpuRequest {
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
  /** 単発四ペナルティ（減点） */
  singleFourPenalty: number;
  /** 禁手追い込みボーナス（白番のみ） */
  forbiddenTrap: number;
}

/**
 * パターンスコア内訳（探索末端用）
 */
export interface LeafPatternScores {
  /** 五連のスコア */
  five: number;
  /** 活四のスコア */
  openFour: number;
  /** 四のスコア */
  four: number;
  /** 活三のスコア */
  openThree: number;
  /** 三のスコア */
  three: number;
  /** 活二のスコア */
  openTwo: number;
  /** 二のスコア */
  two: number;
  /** 合計スコア */
  total: number;
}

/**
 * 探索末端の評価内訳（デバッグ表示用）
 */
export interface LeafEvaluation {
  /** 自分のパターンスコア合計 */
  myScore: number;
  /** 相手のパターンスコア合計 */
  opponentScore: number;
  /** 最終スコア（myScore - opponentScore） */
  total: number;
  /** 自分のパターンスコア内訳 */
  myBreakdown: LeafPatternScores;
  /** 相手のパターンスコア内訳 */
  opponentBreakdown: LeafPatternScores;
}

/**
 * 候補手情報（デバッグ表示用）
 */
export interface CandidateMove {
  /** 着手位置 */
  position: Position;
  /** 即時評価スコア（内訳の合計） */
  score: number;
  /** 探索スコア（複数手先読みの結果、順位の根拠） */
  searchScore: number;
  /** 順位（1始まり、探索スコア順） */
  rank: number;
  /** 即時評価の内訳 */
  breakdown?: ScoreBreakdown;
  /** Principal Variation（探索で予想される手順） */
  principalVariation?: Position[];
  /** 探索末端での評価内訳 */
  leafEvaluation?: LeafEvaluation;
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
 * 探索統計（デバッグ表示用）
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
 * CPU着手レスポンス（Worker通信用）
 */
export interface CpuResponse {
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
  /** 探索統計（デバッグ用） */
  searchStats?: SearchStats;
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
  /** 棋譜文字列（"H8 G7 I9 ..."形式、gameRecordParser互換） */
  moveHistory?: string;
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
