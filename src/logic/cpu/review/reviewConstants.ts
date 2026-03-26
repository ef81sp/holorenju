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
  maxNodes: 2_000_000,
  evaluationOptions: DIFFICULTY_PARAMS.hard.evaluationOptions,
} as const;

/** 確定局面（被追詰/必勝）の minimax ノード上限（候補表示用） */
export const REVIEW_REDUCED_NODES = 500_000;

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
