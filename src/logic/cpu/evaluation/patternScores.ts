/**
 * パターンスコア定数と評価オプション
 *
 * 評価関数で使用する定数と型を一元管理（SSoT）
 */

/**
 * パターンスコア定数
 */
export const PATTERN_SCORES = {
  /** 五連（勝利） */
  FIVE: 100000,
  /** 活四（両端開） */
  OPEN_FOUR: 10000,
  /** 禁手追い込み強（四の防御点が禁手） */
  FORBIDDEN_TRAP_STRONG: 8000,
  /** 四三同時作成ボーナス */
  FOUR_THREE_BONUS: 5000,
  /** フクミ手ボーナス（次にVCFがある手） */
  FUKUMI_BONUS: 1500,
  /** 禁手追い込みセットアップ（活三の延長点が禁手） */
  FORBIDDEN_TRAP_SETUP: 1500,
  /** 禁手追い込み三（三の達四点の一つが禁手、もう一方を止めても四で勝ち） */
  FORBIDDEN_TRAP_THREE: 3000,
  /** ミセ手ボーナス（次に四三を作れる手） */
  MISE_BONUS: 1000,
  /** 止め四（片端開） */
  FOUR: 1000,
  /** 活三（両端開） */
  OPEN_THREE: 1000,
  /** 止め三（片端開）- 単独では価値が低い（剣先問題） */
  THREE: 30,
  /** 活二 */
  OPEN_TWO: 50,
  /** 止め二 */
  TWO: 10,
  /** 中央寄りボーナス */
  CENTER_BONUS: 5,
  /** 禁じ手誘導ボーナス（白番・旧定数、後方互換） */
  FORBIDDEN_TRAP: 100,
  /** 複数方向脅威ボーナス（2方向以上の脅威に追加） */
  MULTI_THREAT_BONUS: 500,
  /** VCT（三・四連続勝ち）ボーナス */
  VCT_BONUS: 8000,
  /** カウンターフォー倍率 */
  COUNTER_FOUR_MULTIPLIER: 1.5,
  /** 斜め方向ボーナス係数（斜め連は隣接空き点が多く効率が良い） */
  DIAGONAL_BONUS_MULTIPLIER: 1.05,
  /** 禁手脆弱性（強）: 三の延長点が禁手で白の攻撃ライン上 */
  FORBIDDEN_VULNERABILITY_STRONG: 800,
  /** 禁手脆弱性（弱）: 三の延長点が禁手（白の攻撃なし） */
  FORBIDDEN_VULNERABILITY_MILD: 300,
  /** 禁手脆弱性ペナルティの合計上限 */
  FORBIDDEN_VULNERABILITY_CAP: 1500,
} as const;

/**
 * 評価オプション
 * 重い評価処理を難易度に応じて有効/無効化する
 */
export interface EvaluationOptions {
  /** フクミ手（VCF）評価を有効にするか */
  enableFukumi: boolean;
  /** ミセ手評価を有効にするか */
  enableMise: boolean;
  /** 禁手追い込み評価を有効にするか */
  enableForbiddenTrap: boolean;
  /** 複数方向脅威ボーナスを有効にするか */
  enableMultiThreat: boolean;
  /** カウンターフォー（防御しながら四を作る）を有効にするか */
  enableCounterFour: boolean;
  /** VCT（三・四連続勝ち）探索を有効にするか */
  enableVCT: boolean;
  /** 必須防御ルールを有効にするか（相手の活四・活三を止めない手を除外） */
  enableMandatoryDefense: boolean;
  /** 単発四の低評価を有効にするか（後続脅威がない四にペナルティ） */
  enableSingleFourPenalty: boolean;
  /**
   * 単発四ペナルティ後の残存倍率（0.0〜1.0）
   * 0.0 = 完全に無価値（四のスコアを全て打ち消す）
   * 1.0 = ペナルティなし
   * デフォルト: 0.0（hard用、単独の四は攻撃リソースの浪費なので価値なし）
   */
  singleFourPenaltyMultiplier: number;
  /** ミセ手脅威防御を有効にするか（相手のミセ手を止めない手を除外） */
  enableMiseThreat: boolean;
  /** Null Move Pruning を有効にするか */
  enableNullMovePruning: boolean;
  /** Futility Pruning を有効にするか */
  enableFutilityPruning: boolean;
  /** 黒番の禁手脆弱性評価を有効にするか（ルートレベル・ムーブオーダリング） */
  enableForbiddenVulnerability: boolean;
  /** 事前計算された脅威情報（最適化用、ルートノードで計算して渡す） */
  precomputedThreats?: ThreatInfo;
}

/**
 * デフォルトの評価オプション（全て無効 = 高速モード）
 */
export const DEFAULT_EVAL_OPTIONS: EvaluationOptions = {
  enableFukumi: false,
  enableMise: false,
  enableForbiddenTrap: false,
  enableMultiThreat: false,
  enableCounterFour: false,
  enableVCT: false,
  enableMandatoryDefense: false,
  enableSingleFourPenalty: false,
  singleFourPenaltyMultiplier: 1.0, // ペナルティ無効時は1.0（100%維持）
  enableMiseThreat: false,
  enableNullMovePruning: false,
  enableFutilityPruning: false,
  enableForbiddenVulnerability: false,
};

/**
 * 全機能有効の評価オプション
 */
export const FULL_EVAL_OPTIONS: EvaluationOptions = {
  enableFukumi: true,
  enableMise: true,
  enableForbiddenTrap: true,
  enableMultiThreat: true,
  enableCounterFour: true,
  enableVCT: true,
  enableMandatoryDefense: true,
  enableSingleFourPenalty: true,
  singleFourPenaltyMultiplier: 0.0, // 全機能有効時は0.0（単独四は完全に無価値）
  enableMiseThreat: true,
  enableNullMovePruning: true,
  enableFutilityPruning: true,
  enableForbiddenVulnerability: true,
};

/**
 * 相手の脅威情報
 */
export interface ThreatInfo {
  /** 活四の防御位置（両端空き = 防御不可） */
  openFours: { row: number; col: number }[];
  /** 止め四の防御位置（片側空き = 1点で防御可） */
  fours: { row: number; col: number }[];
  /** 活三の防御位置 */
  openThrees: { row: number; col: number }[];
  /** ミセ手（次に四三が作れる位置） */
  mises: { row: number; col: number }[];
}

/**
 * 端の状態
 */
export type EndState = "empty" | "opponent" | "edge";

/**
 * 方向パターン分析結果
 */
export interface DirectionPattern {
  /** 連続する石の数 */
  count: number;
  /** 正方向の端の状態 */
  end1: EndState;
  /** 負方向の端の状態 */
  end2: EndState;
}

/**
 * 跳びパターンの分析結果
 */
export interface JumpPatternResult {
  /** 跳び四がある（連続四 or 跳び四） */
  hasFour: boolean;
  /** 跳び四の数（連続四は含まない） */
  jumpFourCount: number;
  /** 活跳び四がある（両端が空いている跳び四は存在しないので連続四のみ） */
  hasOpenFour: boolean;
  /** 跳び三がある */
  hasJumpThree: boolean;
  /** 有効な活三がある（連続三・跳び三ともにウソの三でない） */
  hasValidOpenThree: boolean;
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
 * パターン内訳
 */
export interface PatternBreakdown {
  five: PatternScoreDetail;
  openFour: PatternScoreDetail;
  four: PatternScoreDetail;
  openThree: PatternScoreDetail;
  three: PatternScoreDetail;
  openTwo: PatternScoreDetail;
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
 * 末端評価オプション
 */
export interface LeafEvaluationOptions {
  /** 単発四ペナルティ倍率（0.0〜1.0、デフォルト1.0=ペナルティなし） */
  singleFourPenaltyMultiplier?: number;
}

/**
 * パターンスコア内訳（探索末端用）
 */
export interface LeafPatternScores {
  five: number;
  openFour: number;
  four: number;
  openThree: number;
  three: number;
  openTwo: number;
  two: number;
  total: number;
}

/**
 * 盤面評価の内訳（探索末端用）
 */
export interface BoardEvaluationBreakdown {
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
 * パターンタイプ
 */
export type PatternType =
  | "five"
  | "openFour"
  | "four"
  | "openThree"
  | "three"
  | "openTwo"
  | "two"
  | null;

/**
 * 空のパターンスコア詳細を作成
 */
export function emptyScoreDetail(): PatternScoreDetail {
  return { base: 0, diagonalBonus: 0, final: 0 };
}

/**
 * 空のパターンスコア内訳を作成
 */
export function emptyLeafPatternScores(): LeafPatternScores {
  return {
    five: 0,
    openFour: 0,
    four: 0,
    openThree: 0,
    three: 0,
    openTwo: 0,
    two: 0,
    total: 0,
  };
}

/**
 * 空のパターン内訳を作成
 */
export function emptyPatternBreakdown(): PatternBreakdown {
  return {
    five: emptyScoreDetail(),
    openFour: emptyScoreDetail(),
    four: emptyScoreDetail(),
    openThree: emptyScoreDetail(),
    three: emptyScoreDetail(),
    openTwo: emptyScoreDetail(),
    two: emptyScoreDetail(),
  };
}
