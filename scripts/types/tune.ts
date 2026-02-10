/**
 * SPSAパラメータチューニングの型定義
 */

// ============================================================================
// チューニング対象パラメータ
// ============================================================================

/** チューニング対象パラメータ1つの定義 */
export interface TunableParam {
  /** パラメータ名（PATTERN_SCORESのキー名と対応） */
  name: string;
  /** 初期値 */
  initial: number;
  /** 下限 */
  min: number;
  /** 上限 */
  max: number;
  /** 摂動ステップ（c_k に掛ける値） */
  step: number;
}

/** チューニング対象パラメータセット */
export interface TunableParamSet {
  /** パラメータ一覧 */
  params: TunableParam[];
}

// ============================================================================
// SPSA設定
// ============================================================================

/** SPSA アルゴリズム設定 */
export interface SPSAConfig {
  /** イテレーション数 */
  iterations: number;
  /** 各イテレーションの対局数（θ+ vs θ-） */
  gamesPerIteration: number;
  /** SPSA a パラメータ（学習率） */
  a: number;
  /** SPSA c パラメータ（摂動サイズ） */
  c: number;
  /** SPSA A パラメータ（安定化定数、通常 iterations * 0.1） */
  A: number;
  /** SPSA alpha パラメータ（aの減衰率） */
  alpha: number;
  /** SPSA gamma パラメータ（cの減衰率） */
  gamma: number;
}

/** デフォルトSPSA設定 */
export const DEFAULT_SPSA_CONFIG: SPSAConfig = {
  iterations: 100,
  gamesPerIteration: 40,
  a: 1.0,
  c: 1.0,
  A: 10,
  alpha: 0.602,
  gamma: 0.101,
};

// ============================================================================
// チューニング結果
// ============================================================================

/** 1イテレーションの結果 */
export interface IterationResult {
  /** イテレーション番号 */
  iteration: number;
  /** θ+ のスコア（勝率） */
  scorePlus: number;
  /** θ- のスコア（勝率） */
  scoreMinus: number;
  /** 更新後のパラメータ値 */
  params: Record<string, number>;
  /** 推定勾配 */
  gradient: Record<string, number>;
}

/** チューニング結果全体 */
export interface TuneResult {
  /** タイムスタンプ */
  timestamp: string;
  /** 設定 */
  config: SPSAConfig;
  /** チューニング対象パラメータ定義 */
  tunableParams: TunableParam[];
  /** 初期パラメータ値 */
  initialParams: Record<string, number>;
  /** 最終パラメータ値 */
  finalParams: Record<string, number>;
  /** 全イテレーション結果 */
  iterations: IterationResult[];
  /** 所要時間（秒） */
  elapsedSeconds: number;
  /** 総対局数 */
  totalGames: number;
}
