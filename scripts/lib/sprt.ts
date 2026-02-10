/**
 * SPRT (Sequential Probability Ratio Test) 実装
 *
 * Fishtest方式の逐次検定。対局を1局ずつ進めながら
 * candidate が baseline より有意に強いかを判定する。
 */

import type {
  SPRTConfig,
  SPRTDecision,
  SPRTState,
  WDLCount,
} from "../types/ab.ts";

/** デフォルトSPRT設定 */
export const DEFAULT_SPRT_CONFIG: SPRTConfig = {
  elo0: 0,
  elo1: 30,
  alpha: 0.05,
  beta: 0.05,
};

/**
 * Elo差からスコア期待値を計算
 *
 * @param eloDiff Elo差
 * @returns 期待勝率（0-1）
 */
function eloToScore(eloDiff: number): number {
  return 1 / (1 + 10 ** (-eloDiff / 400));
}

/**
 * WDLからスコア（勝率）を計算
 *
 * @param wdl WDLカウント
 * @returns スコア（0-1）
 */
function wdlToScore(wdl: WDLCount): number {
  const total = wdl.wins + wdl.draws + wdl.losses;
  if (total === 0) {
    return 0.5;
  }
  return (wdl.wins + 0.5 * wdl.draws) / total;
}

/**
 * 三項分布のlog-likelihood
 *
 * WDL結果に対して、期待スコアeに対するlog-likelihoodを計算。
 * 引き分け率は固定（観測された引き分け率）として、
 * 勝敗の確率をeに合わせて配分する。
 *
 * @param wdl WDLカウント
 * @param expectedScore 仮説下の期待スコア
 * @returns log-likelihood
 */
function logLikelihood(wdl: WDLCount, expectedScore: number): number {
  const total = wdl.wins + wdl.draws + wdl.losses;
  if (total === 0) {
    return 0;
  }

  // 観測された引き分け率を固定
  const drawRate = wdl.draws / total;

  // 残りのスコアを勝敗に配分
  // expectedScore = winRate + 0.5 * drawRate
  // winRate = expectedScore - 0.5 * drawRate
  const winRate = Math.max(
    0.001,
    Math.min(0.999, expectedScore - 0.5 * drawRate),
  );
  const lossRate = Math.max(0.001, 1 - drawRate - winRate);
  const safeDrawRate = Math.max(0.001, drawRate);

  // log-likelihood
  let ll = 0;
  if (wdl.wins > 0) {
    ll += wdl.wins * Math.log(winRate);
  }
  if (wdl.draws > 0) {
    ll += wdl.draws * Math.log(safeDrawRate);
  }
  if (wdl.losses > 0) {
    ll += wdl.losses * Math.log(lossRate);
  }

  return ll;
}

/**
 * SPRT のLLR（Log-Likelihood Ratio）を計算
 *
 * LLR = logL(WDL | H1) - logL(WDL | H0)
 *
 * @param wdl WDLカウント
 * @param config SPRT設定
 * @returns LLR値
 */
export function calculateLLR(wdl: WDLCount, config: SPRTConfig): number {
  const score0 = eloToScore(config.elo0);
  const score1 = eloToScore(config.elo1);

  const ll0 = logLikelihood(wdl, score0);
  const ll1 = logLikelihood(wdl, score1);

  return ll1 - ll0;
}

/**
 * SPRTの判定閾値を計算
 *
 * @param config SPRT設定
 * @returns [lowerBound, upperBound]
 */
export function calculateBounds(config: SPRTConfig): [number, number] {
  const lower = Math.log(config.beta / (1 - config.alpha));
  const upper = Math.log((1 - config.beta) / config.alpha);
  return [lower, upper];
}

/**
 * SPRT状態を更新
 *
 * @param wdl 現在のWDLカウント
 * @param config SPRT設定
 * @returns SPRT状態
 */
export function updateSPRT(wdl: WDLCount, config: SPRTConfig): SPRTState {
  const llr = calculateLLR(wdl, config);
  const [lowerBound, upperBound] = calculateBounds(config);

  let decision: SPRTDecision = "continue";
  if (llr >= upperBound) {
    decision = "H1"; // candidate ≥ elo1
  } else if (llr <= lowerBound) {
    decision = "H0"; // candidate ≤ elo0
  }

  return {
    llr,
    upperBound,
    lowerBound,
    decision,
  };
}

/**
 * SPRT状態をフォーマット
 */
export function formatSPRT(state: SPRTState, wdl: WDLCount): string {
  const total = wdl.wins + wdl.draws + wdl.losses;
  const score = wdlToScore(wdl);
  const decisionLabels: Record<SPRTDecision, string> = {
    H1: "H1 (有意な改善)",
    H0: "H0 (改善なし)",
    continue: "continue",
  };
  const decisionStr = decisionLabels[state.decision];

  return [
    `SPRT: LLR=${state.llr.toFixed(2)} [${state.lowerBound.toFixed(2)}, ${state.upperBound.toFixed(2)}]`,
    `  判定: ${decisionStr}`,
    `  ${total}局: +${wdl.wins} =${wdl.draws} -${wdl.losses} (スコア ${(score * 100).toFixed(1)}%)`,
  ].join("\n");
}
