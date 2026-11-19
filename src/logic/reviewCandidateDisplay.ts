/**
 * 振り返り画面 候補手グリッドの表示ルール
 * （docs/plans/review-right-panel-redesign-2026-11-19.md）
 *
 * - 候補は最大 3 件。最善手と自分の手（必須）は必ず含め、残り枠を上位から補う
 * - スコア差の代わりに S/A/B/C ランクを出す。しきい値は品質判定と共通（SSoT）
 */

import type { MoveQuality } from "@/types/review";

import { classifyMoveQuality } from "./reviewLogic";

/** 候補手グリッドに並べる最大件数 */
export const MAX_DISPLAY_CANDIDATES = 3;

/** 候補手のランク（S が最善） */
export type CandidateGrade = "S" | "A" | "B" | "C";

function gradeOfQuality(quality: MoveQuality): CandidateGrade {
  switch (quality) {
    case "excellent":
      return "S";
    case "good":
      return "A";
    case "inaccuracy":
      return "B";
    case "mistake":
    case "blunder":
    case "forcedReply":
      return "C";
    default: {
      const _exhaustive: never = quality;
      return _exhaustive;
    }
  }
}

/**
 * 最善との差（delta = searchScore − best.searchScore、通常 0 以下）からランクを求める。
 *
 * 上限値（scoreExact=false）の候補もその値で判定する。真値は上限以下なので、
 * ランクが実際より良く出ることはない。
 */
export function gradeFromDelta(delta: number): CandidateGrade {
  return gradeOfQuality(classifyMoveQuality(-delta));
}

/**
 * 表示する候補を選ぶ。必須（最善手・自分の手）を必ず含め、残り枠を先頭から補う。
 * 戻り値は元の並び順を保つ。
 */
export function selectDisplayCandidates<T>(
  items: readonly T[],
  isRequired: (item: T) => boolean,
  max: number = MAX_DISPLAY_CANDIDATES,
): T[] {
  if (items.length <= max) {
    return [...items];
  }
  const requiredCount = items.filter(isRequired).length;
  let optionalSlots = Math.max(0, max - requiredCount);
  return items.filter((item) => {
    if (isRequired(item)) {
      return true;
    }
    if (optionalSlots > 0) {
      optionalSlots--;
      return true;
    }
    return false;
  });
}
