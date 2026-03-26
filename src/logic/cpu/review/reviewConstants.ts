/**
 * 振り返り評価の探索パラメータ定数
 *
 * review.worker.ts と抽出モジュールの両方から参照する SSoT。
 */

import { DIFFICULTY_PARAMS } from "@/types/cpu";

import type { VCTSearchOptions } from "../search/vct";

/** 振り返り専用の探索パラメータ（hardから分離し深度を引き上げ） */
export const REVIEW_SEARCH_PARAMS = {
  depth: 8,
  maxNodes: 1_000_000, // 2M → 1M: 探索時間半減
  evaluationOptions: DIFFICULTY_PARAMS.hard.evaluationOptions,
} as const;

/** 確定局面（被追詰/必勝）の minimax ノード上限（候補表示用、精密モードのみ） */
export const REVIEW_REDUCED_NODES = 500_000;

/**
 * 振り返り解析プロファイル
 *
 * 高速モード: main 相当の時間制限ベース探索
 * 精密モード: ノード数制限 + Aspiration Window 段階的拡大 + PV 事後検証
 */
export const REVIEW_PROFILE_FAST = {
  maxNodes: 2_000_000,
  timeLimit: 15_000 as number | undefined,
  absoluteTimeLimit: 20_000 as number | undefined,
  aspirationWidths: undefined as number[] | undefined,
  verifyCandidatesBudget: "dynamic" as "dynamic" | number,
  enablePVVerification: false,
  clearTT: true,
};

export const REVIEW_PROFILE_PRECISE = {
  maxNodes: 1_000_000,
  timeLimit: 15_000 as number | undefined,
  absoluteTimeLimit: 20_000 as number | undefined,
  aspirationWidths: [75, 200, 500] as number[] | undefined,
  verifyCandidatesBudget: Infinity as "dynamic" | number,
  enablePVVerification: true,
  clearTT: false,
};

/** 振り返り用VCT探索パラメータ（forcedWin表示用、分岐収集あり） */
export const REVIEW_VCT_OPTIONS_WITH_BRANCHES: VCTSearchOptions = {
  maxDepth: 6,
  timeLimit: Infinity,
  maxNodes: 500_000,
  vcfOptions: {
    maxDepth: 16,
  },
  collectBranches: true,
};
