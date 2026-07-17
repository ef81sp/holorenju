/**
 * CPU対戦関連の型定義
 */

import type { EvaluationOptions } from "@/logic/cpu/evaluation";
import type { PatternScoreDetail } from "@/logic/cpu/evaluation/patternScores";

import type { BoardState, Position, StoneColor } from "./game";

// SSoT: patternScores.ts に定義された型を re-export
export type { PatternScoreDetail };

/**
 * CPU難易度
 */
export type CpuDifficulty = "beginner" | "easy" | "medium" | "hard";

/** 難易度の★表示ラベル */
export const DIFFICULTY_LABELS: Record<CpuDifficulty, string> = {
  beginner: "★",
  easy: "★★",
  medium: "★★★",
  hard: "★★★★",
};

/** 難易度のアクセシビリティラベル */
export const DIFFICULTY_ARIA_LABELS: Record<CpuDifficulty, string> = {
  beginner: "★1つ",
  easy: "★2つ",
  medium: "★3つ",
  hard: "★4つ",
};

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
  /**
   * |wasmResult.score| >= この閾値ならランダム化をスキップする。
   * 活三 OPEN_THREE=1000、止め四 FOUR=1500 を基準に決める。
   * undefined のときは脅威があってもランダム化される（Lv1 = 三を見逃しうる）。
   * Lv2 以上はここを設定して「ランダムが発動しても活三以上の脅威は防ぐ」状態にする。
   */
  randomCriticalScoreThreshold?: number;
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
 * - beginner: 防御のみ有効
 * - easy: 防御+戦術認識有効
 * - medium: ミセ手・複数方向脅威・カウンターフォー有効
 * - hard: 全機能有効（VCT含む）
 */
export const DIFFICULTY_PARAMS: Record<CpuDifficulty, DifficultyParams> = {
  beginner: {
    // 「初心者でほぼ毎回勝てる」想定。詰みが正確すぎたため弱体化:
    // - depth 1: 1手読みで四追いの連続詰みを発見できなくする
    // - randomFactor 0.3: 30% の確率で近傍空き点からランダム選択（三も時々見逃す）
    // - randomCriticalScoreThreshold: 未設定（脅威があってもランダム化される）
    // - enableMandatoryDefense: true: 評価関数が中央付近に寄り、辺境への bestMove を防ぐ
    //   （防御を切ると bestMove 自体が辺境に飛ぶ → ランダム近傍化が無意味化する）
    depth: 1,
    timeLimit: 1000,
    randomFactor: 0.3,
    maxNodes: 30000,
    evaluationOptions: {
      enableFukumi: false,
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: false,
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: true,
      enableSingleFourPenalty: true,
      singleFourPenaltyMultiplier: 0.6,
      enableMiseThreat: false,
      enableDoubleThreeThreat: false,
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    },
    scoreThreshold: 400, // 現状未配線（将来的に候補手フィルタを実装する場合に使う）
  },
  easy: {
    // depth 1: 連続四（四追い）を読めなくする。
    // Lv1 との差別化は randomCriticalScoreThreshold / enableDoubleThreeThreat 等で確保。
    depth: 1,
    timeLimit: 1500,
    randomFactor: 0.18, // 18%で近傍ランダム（活三以上の脅威時はスキップされる）
    randomCriticalScoreThreshold: 800, // 活三 OPEN_THREE=1000 以上の脅威はランダム時もスキップ
    maxNodes: 60000,
    evaluationOptions: {
      enableFukumi: false,
      // 追詰／禁手追込を能動的に使わせない:
      // - enableMise: false（ミセ=四三・連続四の起点）
      // - enableCounterFour: false（四返しの攻撃起点）
      // - enableVCT/enableForbiddenTrap: false（直接機能。元から無効）
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: true, // 複数方向脅威の認識（配置評価。攻撃起点ではない）
      enableCounterFour: false,
      enableVCT: false,
      enableMandatoryDefense: true, // 致命的ミスを減らす（活四/活三防御は維持）
      enableSingleFourPenalty: true,
      singleFourPenaltyMultiplier: 0.4, // 60%減点。四は打つが優先度は低め
      enableMiseThreat: false, // ミセ手脅威への防御は切る（攻撃トラップに引っかかる余地）
      enableDoubleThreeThreat: true, // 三三脅威への防御（致命的なので維持）
      enableNullMovePruning: false,
      enableFutilityPruning: false,
      enableForbiddenVulnerability: false,
    },
    scoreThreshold: 150, // ランダム選択幅を狭める（強化）
  },
  medium: {
    depth: 3,
    timeLimit: 5000, // TPE対策
    randomFactor: 0.1, // 10%で悪手（Lv4 との差別化のため微増）
    randomCriticalScoreThreshold: 800, // 活三以上の脅威はランダム時もスキップ
    maxNodes: 200000,
    evaluationOptions: {
      enableFukumi: false, // 探索効率を優先
      // 追詰関連を切る（Lv4 との差別化）
      enableMise: false,
      enableForbiddenTrap: false,
      enableMultiThreat: true,
      enableCounterFour: true,
      enableVCT: false,
      enableMandatoryDefense: true,
      enableSingleFourPenalty: true,
      singleFourPenaltyMultiplier: 0.3, // 70%減点に緩和（単独四にも価値を認める）
      enableMiseThreat: true,
      enableDoubleThreeThreat: true,
      enableNullMovePruning: false,
      enableFutilityPruning: true, // depth 3 でも浅い末端の効率化に有用
      enableForbiddenVulnerability: false,
    },
    scoreThreshold: 150, // ランダム選択幅
  },
  hard: {
    depth: 7,
    timeLimit: 10000,
    randomFactor: 0,
    maxNodes: 1000000,
    evaluationOptions: {
      enableFukumi: true,
      enableMise: true,
      enableForbiddenTrap: true,
      enableMultiThreat: true,
      enableCounterFour: true,
      enableVCT: true,
      enableMandatoryDefense: true,
      enableSingleFourPenalty: true,
      // 配線修正に伴い実態値へ修正（0.0 の採否は別途ベンチで判断）。
      // 修正前: 0.0 がエンコード衝突（0=未指定と同じ扱い）で実際は 1.0（ペナルティなし）として動作。
      // 修正後: 0.0 が正しくセンチネル(255)でエンコードされるため 0.0 のまま渡すと全ペナルティが有効。
      // この PR は純粋な配線修正（挙動不変）のため、修正前の実態に合わせて 1.0 に設定する。
      singleFourPenaltyMultiplier: 1.0,
      enableMiseThreat: true,
      enableDoubleThreeThreat: true,
      enableNullMovePruning: true, // depth 4 の中断率削減
      enableFutilityPruning: true,
      enableForbiddenVulnerability: true, // 黒番の禁手脆弱性評価
      // P5-a: Gate 2（Elo +181、docs/plans/eval-basis-prospect-2026-07-13.md §5）
      // で採用決定した空点プロスペクト基底に hard（★4）のみ切り替える。
      // beginner〜medium は難易度カーブを壊さないため legacy のまま据え置く。
      evalBasis: "prospect",
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
 * 候補手情報（デバッグ表示用）
 */
export interface CandidateMove {
  /** 着手位置 */
  position: Position;
  /** 探索スコア（複数手先読みの結果、順位の根拠） */
  searchScore: number;
  /** 順位（1始まり、探索スコア順） */
  rank: number;
  /** Principal Variation（探索で予想される手順） */
  principalVariation?: Position[];
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
  /** 同スコアのタイブレークで選択されたか */
  wasTieBreak: boolean;
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
  /** 強制手フラグ（候補手1つ、スコアは参考値） */
  forcedMove?: boolean;
  /** 時間制限フォールバックが発動したか */
  timePressureFallback?: boolean;
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
  /** 使用した珠型名 */
  jushu?: string;
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
