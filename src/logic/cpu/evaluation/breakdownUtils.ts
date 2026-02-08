/**
 * スコア内訳の表示ユーティリティ
 *
 * CpuDebugInfoとReviewEvalPanelで共通利用する
 * 内訳の非ゼロ項目抽出・ラベル定義・フォーマット関数
 */

import type {
  LeafPatternScores,
  PatternScoreDetail,
  ScoreBreakdown,
} from "@/types/cpu";

/** パターン内訳のラベル */
export const patternLabels: Record<string, string> = {
  five: "五連",
  openFour: "活四",
  four: "四",
  openThree: "活三",
  three: "三",
  openTwo: "活二",
  two: "二",
};

/** ボーナス内訳項目のラベル */
export const bonusLabels: Record<string, string> = {
  fourThree: "四三",
  fukumi: "フクミ手",
  mise: "ミセ手",
  center: "中央",
  multiThreat: "複数脅威",
  singleFourPenalty: "単発四ペナ",
  forbiddenTrap: "禁手追込",
};

/** パターン内訳の項目 */
export interface PatternItem {
  key: string;
  label: string;
  detail: PatternScoreDetail;
}

/** ボーナス内訳の項目 */
export interface BonusItem {
  key: string;
  label: string;
  value: number;
}

/** 末端評価の内訳項目 */
export interface LeafBreakdownItem {
  key: string;
  label: string;
  score: number;
}

/**
 * 内訳の非ゼロ項目を取得（攻撃・防御・ボーナスを分離）
 */
export function getNonZeroBreakdown(breakdown: ScoreBreakdown): {
  patterns: PatternItem[];
  defense: PatternItem[];
  bonuses: BonusItem[];
} {
  // 攻撃パターン内訳
  const patterns = Object.entries(breakdown.pattern)
    .filter(([, detail]) => (detail as PatternScoreDetail).final !== 0)
    .map(([key, detail]) => ({
      key,
      label: patternLabels[key] ?? key,
      detail: detail as PatternScoreDetail,
    }));

  // 防御パターン内訳
  const defense = Object.entries(breakdown.defense)
    .filter(([, detail]) => (detail as PatternScoreDetail).final !== 0)
    .map(([key, detail]) => ({
      key,
      label: patternLabels[key] ?? key,
      detail: detail as PatternScoreDetail,
    }));

  // ボーナス内訳
  const bonuses = Object.entries(breakdown)
    .filter(
      ([key, value]) => key !== "pattern" && key !== "defense" && value !== 0,
    )
    .map(([key, value]) => ({
      key,
      label: bonusLabels[key] ?? key,
      // ペナルティは減点なので符号を反転
      value:
        key === "singleFourPenalty" ? -(value as number) : (value as number),
    }));

  return { patterns, defense, bonuses };
}

/**
 * スコアを符号付きで表示
 */
export function formatScore(score: number): string {
  if (score >= 0) {
    return `+${score}`;
  }
  return String(score);
}

/**
 * パターンスコアの表示文字列を生成
 * 倍率がある場合: "preMultiplier × multiplier = final"
 * 斜めボーナスがある場合: "base + bonus = final"
 * ない場合: "+final"
 */
export function formatPatternScore(detail: PatternScoreDetail): string {
  // 倍率が適用されている場合（防御など）
  if (detail.multiplier !== undefined && detail.preMultiplier !== undefined) {
    if (detail.preMultiplier === 0) {
      return formatScore(detail.final);
    }
    // 斜めボーナスもある場合: "(base + bonus) × multiplier = final"
    if (detail.diagonalBonus !== 0) {
      const preMultBase = Math.round(detail.base / detail.multiplier);
      const preMultBonus = Math.round(detail.diagonalBonus / detail.multiplier);
      return `(${preMultBase} + ${preMultBonus}) × ${detail.multiplier} = ${detail.final}`;
    }
    return `${detail.preMultiplier} × ${detail.multiplier} = ${detail.final}`;
  }
  // 斜めボーナスのみの場合
  if (detail.diagonalBonus !== 0) {
    return `${detail.base} + ${detail.diagonalBonus} = ${detail.final}`;
  }
  return formatScore(detail.final);
}

/**
 * 末端評価の内訳から非ゼロ項目を取得
 */
export function getLeafBreakdownItems(
  breakdown: LeafPatternScores,
): LeafBreakdownItem[] {
  const items: LeafBreakdownItem[] = [];
  if (breakdown.five !== 0) {
    items.push({ key: "five", label: "五連", score: breakdown.five });
  }
  if (breakdown.openFour !== 0) {
    items.push({ key: "openFour", label: "活四", score: breakdown.openFour });
  }
  if (breakdown.four !== 0) {
    items.push({ key: "four", label: "四", score: breakdown.four });
  }
  if (breakdown.openThree !== 0) {
    items.push({
      key: "openThree",
      label: "活三",
      score: breakdown.openThree,
    });
  }
  if (breakdown.three !== 0) {
    items.push({ key: "three", label: "三", score: breakdown.three });
  }
  if (breakdown.openTwo !== 0) {
    items.push({ key: "openTwo", label: "活二", score: breakdown.openTwo });
  }
  if (breakdown.two !== 0) {
    items.push({ key: "two", label: "二", score: breakdown.two });
  }
  return items;
}
