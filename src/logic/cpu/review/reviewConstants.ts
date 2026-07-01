/**
 * 振り返り評価の探索パラメータ定数
 *
 * review.worker.ts と抽出モジュールの両方から参照する SSoT。
 */

import { DIFFICULTY_PARAMS } from "@/types/cpu";

import type { VCTSearchOptions } from "../search/types";

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
/**
 * 高速モード時間上限の根拠（2026-06-14, profile-review 実測）:
 * - eval=hard 配線(A1)とセットで運用する前提で 5_000ms。
 * - 旧 15_000 比で 1局解析時間 -約47%。
 * - 白14 F11 のような中盤深度感受性手は eval=hard が depth6 で実スコア(-2588)を見せるため、
 *   tl=5000 でも判定品質を維持できる（実測 excellent）。
 * - eval=hard を切ると(検証時の evalOptionsOverride=0)、tl=5000 では深度不足で判定崩壊する。
 *   A1 と A4 は必ずセット。
 */
export const REVIEW_PROFILE_FAST = {
  maxNodes: 2_000_000,
  timeLimit: 5_000 as number | undefined,
  absoluteTimeLimit: 10_000 as number | undefined,
  aspirationWidths: undefined as number[] | undefined,
  verifyCandidatesBudget: "dynamic" as "dynamic" | number,
  enablePVVerification: false,
  clearTT: true,
  // 評価オプションフラグの上書き（profile-review の --eval=none 検証用）。
  // undefined のとき REVIEW_SEARCH_PARAMS.evaluationOptions（hard 相当）が使われる。
  evalOptionsOverride: undefined as number | undefined,
};

export const REVIEW_PROFILE_PRECISE = {
  maxNodes: 1_000_000,
  timeLimit: 15_000 as number | undefined,
  absoluteTimeLimit: 20_000 as number | undefined,
  aspirationWidths: [75, 200, 500] as number[] | undefined,
  verifyCandidatesBudget: Infinity as "dynamic" | number,
  enablePVVerification: true,
  clearTT: false,
  evalOptionsOverride: undefined as number | undefined,
};

/** 振り返り用VCT探索パラメータ（forcedWin表示用、分岐収集あり） */
export const REVIEW_VCT_OPTIONS_WITH_BRANCHES: VCTSearchOptions = {
  maxDepth: 6,
  // timeLimit を Infinity にすると、maxNodes 500_000 が消化されない密局面で
  // 単発タスクが 60-120s に伸び、pool のスループットを潰す。#104
  // 10s を超える場合は VCT を表示しない（forcedWin sequence は minimax PV にフォールバック）。
  timeLimit: 10_000,
  maxNodes: 500_000,
  vcfOptions: {
    maxDepth: 16,
  },
  collectBranches: true,
};
