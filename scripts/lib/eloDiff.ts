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
export function scoreToElo(score: number): number {
  // スコアが0または1の場合はクランプ
  const clamped = Math.max(0.001, Math.min(0.999, score));
  return -400 * Math.log10(1 / clamped - 1);
}

/**
 * Elo差からスコア期待値を計算（scoreToElo の逆関数）
 *
 * @param eloDiff Elo差
 * @returns 期待勝率（0-1）
 */
export function eloToScore(eloDiff: number): number {
  return 1 / (1 + 10 ** (-eloDiff / 400));
}

/**
 * スコアの平均と標準誤差から Elo 差と 95% 信頼区間を作る。
 * 三項（1 局単位）・ペア（pentanomial）の両方で共用する変換。
 * se が有限でなければ CI は ±Infinity。
 */
export function scoreIntervalToElo(mean: number, se: number): EloDiffResult {
  const z = 1.96;
  const eloDiff = round1(scoreToElo(mean));
  const winRate = Math.round(mean * 1000) / 1000;
  if (!Number.isFinite(se)) {
    return { eloDiff, ci95Lower: -Infinity, ci95Upper: Infinity, winRate };
  }
  const scoreLower = Math.max(0.001, mean - z * se);
  const scoreUpper = Math.min(0.999, mean + z * se);
  return {
    eloDiff,
    ci95Lower: round1(scoreToElo(scoreLower)),
    ci95Upper: round1(scoreToElo(scoreUpper)),
    winRate,
  };
}

/** 小数 1 桁に丸める（-0 は +0 に正規化）。 */
function round1(v: number): number {
  return Math.round(v * 10) / 10 + 0;
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

  // 二項分布近似による標準誤差
  // Var(score) = (W(1-s)^2 + D(0.5-s)^2 + L(s)^2) / N^2
  const w = wdl.wins / total;
  const d = wdl.draws / total;
  const l = wdl.losses / total;
  const variance =
    w * (1 - score) ** 2 + d * (0.5 - score) ** 2 + l * score ** 2;

  const stdError = Math.sqrt(variance / total);

  return scoreIntervalToElo(score, stdError);
}

/**
 * Elo差推定結果をフォーマット
 */
export function formatEloDiff(result: EloDiffResult): string {
  return `Elo差: ${result.eloDiff > 0 ? "+" : ""}${result.eloDiff} [${result.ci95Lower}, ${result.ci95Upper}] (95%CI) 勝率: ${(result.winRate * 100).toFixed(1)}%`;
}
