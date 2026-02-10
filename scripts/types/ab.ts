/**
 * A/B ベンチマーク比較の型定義
 */

import type { DifficultyParams } from "../../src/types/cpu.ts";

// ============================================================================
// SPRT (Sequential Probability Ratio Test)
// ============================================================================

/** SPRT設定 */
export interface SPRTConfig {
  /** 帰無仮説のElo差（H0: candidate ≤ elo0） */
  elo0: number;
  /** 対立仮説のElo差（H1: candidate ≥ elo1） */
  elo1: number;
  /** 第一種の過誤確率 */
  alpha: number;
  /** 第二種の過誤確率 */
  beta: number;
}

/** SPRT判定結果 */
export type SPRTDecision = "H0" | "H1" | "continue";

/** SPRT状態 */
export interface SPRTState {
  /** 現在のLLR */
  llr: number;
  /** 上限閾値（H1採択基準） */
  upperBound: number;
  /** 下限閾値（H0採択基準） */
  lowerBound: number;
  /** 判定結果 */
  decision: SPRTDecision;
}

// ============================================================================
// Elo差推定
// ============================================================================

/** Elo差推定結果 */
export interface EloDiffResult {
  /** Elo差の推定値 */
  eloDiff: number;
  /** 95%信頼区間の下限 */
  ci95Lower: number;
  /** 95%信頼区間の上限 */
  ci95Upper: number;
  /** 勝率（wins + 0.5 * draws / total） */
  winRate: number;
}

// ============================================================================
// A/Bベンチマーク設定・結果
// ============================================================================

/** A/B対戦の候補パラメータ */
export interface ABPlayerConfig {
  /** 識別子 */
  id: string;
  /** 基本難易度 */
  difficulty: "hard";
  /** カスタムパラメータ（DifficultyParamsの部分オーバーライド） */
  customParams?: Partial<DifficultyParams>;
}

/** WDL（勝敗引分け）カウント */
export interface WDLCount {
  wins: number;
  draws: number;
  losses: number;
}

/** A/Bベンチマーク結果 */
export interface ABBenchResult {
  /** タイムスタンプ */
  timestamp: string;
  /** 設定 */
  config: {
    baseline: ABPlayerConfig;
    candidate: ABPlayerConfig;
    gamesPerSide: number;
    sprt: SPRTConfig | null;
  };
  /** 対局数 */
  totalGames: number;
  /** WDL（candidateから見た勝敗） */
  wdl: WDLCount;
  /** Elo差推定 */
  eloDiff: EloDiffResult;
  /** SPRT状態（SPRT有効時のみ） */
  sprt: SPRTState | null;
  /** 所要時間（秒） */
  elapsedSeconds: number;
}
