/**
 * パターンスコア定数と評価オプション
 *
 * 評価関数で使用する定数と型を一元管理（SSoT）
 */

/**
 * パターンスコア定数
 *
 * スコア体系の設計根拠:
 * - 12のOSS実装・学術論文・大会優勝AIの調査結果に基づく
 * - 止め四(FOUR) > 活三(OPEN_THREE): 絶対先手 vs 相対先手の質的差異
 *   - Rapfi(Gomocup優勝)、lihongxun945/gobang 等7-8実装が採用
 * - 連携度ボーナス(CONNECTIVITY_BONUS): 単純加算の限界を補正
 *   - 多方向にパターンを持つ石は四三等の複合脅威に発展しやすい
 * - 防御倍率は directionAnalysis.ts の DEFENSE_MULTIPLIERS で脅威レベル別に分化
 *
 * @see directionAnalysis.ts DEFENSE_MULTIPLIERS — 脅威レベル別の防御倍率
 */
export const PATTERN_SCORES = {
  /** 五連（勝利）— 即座に勝負が決まる絶対値 */
  FIVE: 100000,
  /** 活四（両端開）— 防御不能（2箇所のうち1箇所しか塞げない） */
  OPEN_FOUR: 10000,
  /** 禁手追い込み強（四の防御点が禁手）— 活四ほど確実ではないため控えめに評価 */
  FORBIDDEN_TRAP_STRONG: 5000,
  /** 四三同時作成ボーナス — 防御不能の複合脅威（四を止めると三が通る） */
  FOUR_THREE_BONUS: 5000,
  /**
   * フクミ手ボーナス（次にVCFがある手）
   * @deprecated ゲームプレイ未使用 — evaluatePosition() 内で fukumiBonus = 0 にハードコード。
   * isFukumiMove(hasVCF) の計算コストが高いため、ルートレベル評価のみで使用想定。
   * デバッグ表示 (evaluatePositionWithBreakdown) でのみ参照される。
   */
  FUKUMI_BONUS: 1500,
  /** 禁手追い込みセットアップ（活三の延長点が禁手） */
  FORBIDDEN_TRAP_SETUP: 1500,
  /** 禁手追い込み三（三の達四点の一つが禁手、もう一方を止めても四で勝ち） */
  FORBIDDEN_TRAP_THREE: 3000,
  /** 両ミセボーナス（防御不能、1手後に四三確定）— FOUR_THREE_BONUS(5000)を超えない */
  DOUBLE_MISE_BONUS: 4000,
  /** ミセ手ボーナス（次に四三を作れる手）— 1手後に四三が確定する先手脅威 */
  MISE_BONUS: 1000,
  /**
   * 止め四（片端開）— 絶対先手（防御点1箇所のみ）
   * 活三(1000)より高い理由: 四は三では止められないが、逆は可能（カウンターフォー）。
   * singleFourPenalty により後続脅威のない単発四は減価されるため、
   * 基本スコアの引き上げはVCFに繋がる有意義な四をより正しく評価する。
   */
  FOUR: 1500,
  /**
   * 活三（両端開）— 相対先手（防御点2箇所以上、止める手で反撃可能）
   * 止め四(1500)より低い理由: 活三は防御側に選択肢があり、カウンターフォーで反撃される。
   */
  OPEN_THREE: 1000,
  /** 止め三（片端開）— 単独では価値が低い（剣先問題: 一方向のみの発展性） */
  THREE: 30,
  /** 活二 — 将来的なパターンの素材（連携度で評価を補正） */
  OPEN_TWO: 50,
  /** 止め二 — 発展性が限られた素材 */
  TWO: 10,
  /** 中央寄りボーナス — 中央ほど多方向に展開できるため有利 */
  CENTER_BONUS: 5,
  /** 禁じ手誘導ボーナス（白番・旧定数、後方互換） */
  FORBIDDEN_TRAP: 100,
  /** 複数方向脅威ボーナス（2方向以上の先手脅威に追加）— evaluatePosition() のみ */
  MULTI_THREAT_BONUS: 500,
  /**
   * 防御交差点ボーナス（相手が置くと2方向以上の脅威になる位置の防御価値）
   * 攻撃の MULTI_THREAT_BONUS(500) より低い理由:
   * 防御パターンスコアは各方向の加算で交差効果を部分的に反映済み。
   * 追加ボーナスは「1手では止めきれないシナジー効果」分のみ。
   */
  DEFENSE_MULTI_THREAT_BONUS: 300,
  /**
   * VCT（三・四連続勝ち）ボーナス
   * @deprecated 探索・評価コードで未使用。VCT探索は review.worker.ts のみで使用。
   * 将来的にルートレベルVCT判定を導入する際に活用予定。
   */
  VCT_BONUS: 8000,
  /** カウンターフォー倍率 — 防御しながら四を作る手の防御スコアに適用 */
  COUNTER_FOUR_MULTIPLIER: 1.5,
  /** 斜め方向ボーナス係数 — 斜め連は隣接空き点が多く効率が良い（約5%加算） */
  DIAGONAL_BONUS_MULTIPLIER: 1.05,
  /** 禁手脆弱性（強）: 三の延長点が禁手で白の攻撃ライン上 */
  FORBIDDEN_VULNERABILITY_STRONG: 1000,
  /** 禁手脆弱性（弱）: 三の延長点が禁手（白の攻撃なし） */
  FORBIDDEN_VULNERABILITY_MILD: 400,
  /** 禁手脆弱性ペナルティの合計上限 */
  FORBIDDEN_VULNERABILITY_CAP: 2000,
  /**
   * 末端評価 四三脅威ボーナス（evaluateBoard 用）
   * 「次の1手で四三が作れる空き交点」が存在する場合に加算。
   * FOUR_THREE_BONUS(5000) より保守的: 手番が不明なため確実性が低い。
   * --score-override=LEAF_FOUR_THREE_THREAT:0 で無効化可能。
   */
  LEAF_FOUR_THREE_THREAT: 2000,
  /**
   * パターン連携ボーナス（evaluateBoard 末端評価用）
   * 2方向以上にパターンを持つ石への加点（方向数-1 × この値）。
   * 多方向にパターンがある石は四三等の複合脅威に発展する可能性が高い。
   * OPEN_TWO(50) の約0.6倍 — 方向追加1つごとの控えめなボーナス。
   */
  CONNECTIVITY_BONUS: 30,
  /**
   * テンポ補正: 直前着手者の活三割引率（evaluateBoard 末端評価用）
   * 末端評価で直前着手者の活三は相手未応答のため過大評価される。
   * この割引率を活三スコアに乗じて減算することで奇偶振動を抑制する。
   * 0.5 = 活三スコアの50%を割引（50%保持）
   */
  TEMPO_OPEN_THREE_DISCOUNT: 0.5,
} as const;

/**
 * パターンスコアの値型（オーバーライド用）
 */
export type PatternScoreValues = {
  [K in keyof typeof PATTERN_SCORES]: number;
};

/**
 * 解決済みスコアオブジェクトを生成
 *
 * ゲーム開始時に1回だけ呼び出し、以降はこのオブジェクトを参照する。
 * オーバーライドがなければ元の PATTERN_SCORES をそのまま返す（ゼロコスト）。
 *
 * @param overrides 部分的なオーバーライド値
 * @returns 解決済みスコアオブジェクト
 */
export function resolveScores(
  overrides?: Partial<PatternScoreValues>,
): PatternScoreValues {
  if (!overrides) {
    return PATTERN_SCORES;
  }
  return { ...PATTERN_SCORES, ...overrides } as PatternScoreValues;
}

/**
 * PATTERN_SCORES をランタイムでオーバーライドする（ベンチマーク/チューニング用）
 *
 * Worker スレッドは独立モジュールスコープなので、Worker 内でのみ影響する。
 * メインスレッドでの呼び出しは全体に影響するため注意。
 *
 * @param overrides 部分的なオーバーライド値
 */
export function applyPatternScoreOverrides(
  overrides: Partial<PatternScoreValues>,
): void {
  const mutable = PATTERN_SCORES as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    if (key in PATTERN_SCORES) {
      mutable[key] = value;
    }
  }
  // PACKED_TO_SCORE/TYPE をスコア値に同期
  rebuildPackedTablesCallback?.();
}

/**
 * lineScan.ts が登録するコールバック。
 * 直接 import すると循環参照になるため、コールバック方式で解決。
 */
let rebuildPackedTablesCallback: (() => void) | null = null;

/** lineScan.ts から呼び出してコールバックを登録する */
export function registerRebuildPackedTables(fn: () => void): void {
  rebuildPackedTablesCallback = fn;
}

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
  /** 三三脅威防御を有効にするか（白の三三を止めない手を除外） */
  enableDoubleThreeThreat: boolean;
  /** Null Move Pruning を有効にするか */
  enableNullMovePruning: boolean;
  /** Futility Pruning を有効にするか */
  enableFutilityPruning: boolean;
  /** 黒番の禁手脆弱性評価を有効にするか（ルートレベル・ムーブオーダリング） */
  enableForbiddenVulnerability: boolean;
  /** 事前計算された脅威情報（最適化用、ルートノードで計算して渡す） */
  precomputedThreats?: ThreatInfo;
  /** パターンスコアのオーバーライド値（SPSAチューニング用） */
  patternScoreOverrides?: Partial<PatternScoreValues>;
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
  enableDoubleThreeThreat: false,
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
  enableDoubleThreeThreat: true,
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
  /** 三三脅威（次に三三が作れる位置） */
  doubleThrees: { row: number; col: number }[];
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
  /** ミセ手の種類（表示ラベル解決用） */
  miseType: MiseType;
  /** 中央ボーナス */
  center: number;
  /** 複数方向脅威ボーナス */
  multiThreat: number;
  /** 防御交差点ボーナス（相手が2方向以上の脅威を作る位置の防御価値） */
  defenseMultiThreat: number;
  /** 単発四ペナルティ（減点） */
  singleFourPenalty: number;
  /** 禁手追い込みボーナス（白番のみ） */
  forbiddenTrap: number;
  /** 禁手脆弱性ペナルティ（黒番のみ、減点） */
  forbiddenVulnerability: number;
}

/**
 * 末端評価オプション
 */
export interface LeafEvaluationOptions {
  /** 単発四ペナルティ倍率（0.0〜1.0、デフォルト1.0=ペナルティなし） */
  singleFourPenaltyMultiplier?: number;
  /** パターン連携ボーナス値（デフォルト: CONNECTIVITY_BONUS=30、0で無効） */
  connectivityBonusValue?: number;
  /** 直前着手者が perspective 側か（undefined で無効、後方互換） */
  lastMoverIsPerspective?: boolean;
}

/**
 * ミセ手の種類
 */
export type MiseType = "none" | "mise" | "double-mise";

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
