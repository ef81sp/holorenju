/**
 * Elo差推定 + 95%信頼区間
 *
 * WDL結果からElo差を推定し、信頼区間を計算する。
 */

import type { EloDiffResult, WDLCount } from "../types/ab.ts";

/**
 * スコア（勝率）からElo差を計算
 *
 * @param score 勝率（0-1）
 * @returns Elo差
 */
function scoreToElo(score: number): number {
  // スコアが0または1の場合はクランプ
  const clamped = Math.max(0.001, Math.min(0.999, score));
  return -400 * Math.log10(1 / clamped - 1);
}

/**
 * WDLからElo差を推定し、95%信頼区間を計算
 *
 * @param wdl WDLカウント（candidateから見た勝敗）
 * @returns Elo差推定結果
 */
export function estimateEloDiff(wdl: WDLCount): EloDiffResult {
  const total = wdl.wins + wdl.draws + wdl.losses;

  if (total === 0) {
    return {
      eloDiff: 0,
      ci95Lower: -Infinity,
      ci95Upper: Infinity,
      winRate: 0.5,
    };
  }

  // スコア（勝率）の計算
  const score = (wdl.wins + 0.5 * wdl.draws) / total;

  // Elo差推定
  const eloDiff = scoreToElo(score);

  // 二項分布近似による標準誤差
  // Var(score) = (W(1-s)^2 + D(0.5-s)^2 + L(s)^2) / N^2
  const w = wdl.wins / total;
  const d = wdl.draws / total;
  const l = wdl.losses / total;
  const variance =
    w * (1 - score) ** 2 + d * (0.5 - score) ** 2 + l * score ** 2;

  const stdError = Math.sqrt(variance / total);

  // 95%信頼区間（z=1.96）
  const z = 1.96;
  const scoreLower = Math.max(0.001, score - z * stdError);
  const scoreUpper = Math.min(0.999, score + z * stdError);

  return {
    eloDiff: Math.round(eloDiff * 10) / 10,
    ci95Lower: Math.round(scoreToElo(scoreLower) * 10) / 10,
    ci95Upper: Math.round(scoreToElo(scoreUpper) * 10) / 10,
    winRate: Math.round(score * 1000) / 1000,
  };
}

/**
 * Elo差推定結果をフォーマット
 */
export function formatEloDiff(result: EloDiffResult): string {
  return `Elo差: ${result.eloDiff > 0 ? "+" : ""}${result.eloDiff} [${result.ci95Lower}, ${result.ci95Upper}] (95%CI) 勝率: ${(result.winRate * 100).toFixed(1)}%`;
}
