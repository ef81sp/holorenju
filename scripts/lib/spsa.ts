/**
 * SPSA (Simultaneous Perturbation Stochastic Approximation) アルゴリズム
 *
 * Stockfish の Fishtest と同じ原理でパラメータを自動最適化する。
 * 各イテレーションで θ+ と θ- を生成し、対戦結果から勾配を推定してパラメータを更新。
 */

import type { SPSAConfig, TunableParam } from "../types/tune.ts";

// ============================================================================
// SPSA ゲインスケジュール
// ============================================================================

/**
 * a_k（学習率）を計算
 * a_k = a / (k + A + 1)^alpha
 */
export function computeAk(config: SPSAConfig, k: number): number {
  return config.a / (k + config.A + 1) ** config.alpha;
}

/**
 * c_k（摂動サイズ）を計算
 * c_k = c / (k + 1)^gamma
 */
export function computeCk(config: SPSAConfig, k: number): number {
  return config.c / (k + 1) ** config.gamma;
}

// ============================================================================
// 摂動ベクトル生成
// ============================================================================

/**
 * ランダム摂動ベクトル Δ を生成（各要素 ±1）
 * Bernoulli分布: P(+1) = P(-1) = 0.5
 *
 * @param dimension パラメータの次元数
 * @returns 摂動ベクトル（各要素 ±1）
 */
export function generatePerturbation(dimension: number): number[] {
  return Array.from({ length: dimension }, () =>
    Math.random() < 0.5 ? -1 : 1,
  );
}

// ============================================================================
// パラメータ摂動・更新
// ============================================================================

/**
 * 現在のパラメータに摂動を加えたパラメータセットを生成
 *
 * θ+ = θ + c_k * Δ * step
 * θ- = θ - c_k * Δ * step
 *
 * @param currentParams 現在のパラメータ値
 * @param tunables チューニング対象パラメータ定義
 * @param delta 摂動ベクトル
 * @param ck 現在の摂動サイズ
 * @returns [thetaPlus, thetaMinus]
 */
export function perturbParams(
  currentParams: Record<string, number>,
  tunables: TunableParam[],
  delta: number[],
  ck: number,
): [Record<string, number>, Record<string, number>] {
  const thetaPlus: Record<string, number> = {};
  const thetaMinus: Record<string, number> = {};

  for (let i = 0; i < tunables.length; i++) {
    const param = tunables[i];
    if (!param) {
      continue;
    }
    const d = delta[i] ?? 1;
    const current = currentParams[param.name] ?? param.initial;
    const perturbation = ck * d * param.step;

    thetaPlus[param.name] = clamp(
      Math.round(current + perturbation),
      param.min,
      param.max,
    );
    thetaMinus[param.name] = clamp(
      Math.round(current - perturbation),
      param.min,
      param.max,
    );
  }

  return [thetaPlus, thetaMinus];
}

/**
 * 勾配推定とパラメータ更新
 *
 * g_k = (score+ - score-) / (2 * c_k * Δ * step)
 * θ = θ + a_k * g_k
 *
 * @param currentParams 現在のパラメータ値
 * @param tunables チューニング対象パラメータ定義
 * @param delta 摂動ベクトル
 * @param scorePlus θ+ のスコア
 * @param scoreMinus θ- のスコア
 * @param ak 学習率
 * @param ck 摂動サイズ
 * @returns [updatedParams, gradient]
 */
export function updateParams(
  currentParams: Record<string, number>,
  tunables: TunableParam[],
  delta: number[],
  scorePlus: number,
  scoreMinus: number,
  ak: number,
  ck: number,
): [Record<string, number>, Record<string, number>] {
  const updated: Record<string, number> = {};
  const gradient: Record<string, number> = {};
  const scoreDiff = scorePlus - scoreMinus;

  for (let i = 0; i < tunables.length; i++) {
    const param = tunables[i];
    if (!param) {
      continue;
    }
    const d = delta[i] ?? 1;
    const current = currentParams[param.name] ?? param.initial;

    // 勾配推定: g = (score+ - score-) / (2 * ck * delta * step)
    const denominator = 2 * ck * d * param.step;
    const g = denominator === 0 ? 0 : scoreDiff / denominator;
    gradient[param.name] = g;

    // パラメータ更新: θ = θ + a_k * g_k
    const newValue = clamp(Math.round(current + ak * g), param.min, param.max);
    updated[param.name] = newValue;
  }

  return [updated, gradient];
}

/**
 * 値を範囲内にクランプ
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================================================================
// ヘルパー
// ============================================================================

/**
 * パラメータ値を Record<string, number> 形式に変換
 */
export function tunablesToRecord(
  tunables: TunableParam[],
): Record<string, number> {
  const record: Record<string, number> = {};
  for (const param of tunables) {
    record[param.name] = param.initial;
  }
  return record;
}

/**
 * パラメータ差分を表示用にフォーマット
 */
export function formatParamDiff(
  initial: Record<string, number>,
  current: Record<string, number>,
): string {
  const lines: string[] = [];
  for (const key of Object.keys(initial)) {
    const init = initial[key] ?? 0;
    const curr = current[key] ?? 0;
    const diff = curr - init;
    const pct = init === 0 ? "N/A" : ((diff / init) * 100).toFixed(1);
    const sign = diff >= 0 ? "+" : "";
    lines.push(`  ${key}: ${init} → ${curr} (${sign}${diff}, ${sign}${pct}%)`);
  }
  return lines.join("\n");
}
