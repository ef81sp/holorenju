/**
 * ForcedLossType / ForcedWinType のラベル一元管理
 *
 * reviewLogic.ts の getQualityLabel と同レイヤー。
 * 各コンポーネントの switch-case 重複を解消する SSoT モジュール。
 */

import type { ForcedLossType, ForcedWinType } from "@/types/review";

/** フル表記ラベル（セリフ・アクセシビリティラベル向け） */
export const FULL_LABELS: Record<ForcedLossType, string> = {
  vcf: "四追い",
  vct: "追い詰め",
  "forbidden-trap": "禁手追い込み",
  "mise-vcf": "ミセ四追い",
  "double-mise": "両ミセ",
  "double-three": "三三",
  "double-four": "四四",
};

/** 短縮ラベル（バッジ・候補手ラベル向け） */
export const SHORT_LABELS: Record<ForcedLossType, string> = {
  vcf: "四追",
  vct: "追詰",
  "forbidden-trap": "禁手追込",
  "mise-vcf": "ミセ四追",
  "double-mise": "両ミセ",
  "double-three": "三三",
  "double-four": "四四",
};

/** CPU手の進行中ラベル（「～中」） */
export const CPU_WIN_LABELS: Record<ForcedWinType, string> = {
  vcf: "四追い中",
  vct: "追詰中",
  "forbidden-trap": "禁手追込中",
  "mise-vcf": "ミセ四追中",
  "double-mise": "両ミセ中",
};
