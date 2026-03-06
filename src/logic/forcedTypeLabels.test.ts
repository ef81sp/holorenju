/**
 * forcedTypeLabels のテスト
 *
 * 全 ForcedLossType / ForcedWinType の網羅を検証
 */

import { describe, expect, it } from "vitest";

import type { ForcedLossType, ForcedWinType } from "@/types/review";

import { CPU_WIN_LABELS, FULL_LABELS, SHORT_LABELS } from "./forcedTypeLabels";

const ALL_FORCED_LOSS_TYPES: ForcedLossType[] = [
  "vcf",
  "vct",
  "forbidden-trap",
  "mise-vcf",
  "double-mise",
  "double-three",
  "double-four",
];

const ALL_FORCED_WIN_TYPES: ForcedWinType[] = [
  "vcf",
  "vct",
  "forbidden-trap",
  "mise-vcf",
  "double-mise",
];

describe("FULL_LABELS", () => {
  it("全 ForcedLossType に対応するラベルがある", () => {
    for (const type of ALL_FORCED_LOSS_TYPES) {
      expect(FULL_LABELS[type]).toBeTypeOf("string");
      expect(FULL_LABELS[type].length).toBeGreaterThan(0);
    }
  });
});

describe("SHORT_LABELS", () => {
  it("全 ForcedLossType に対応するラベルがある", () => {
    for (const type of ALL_FORCED_LOSS_TYPES) {
      expect(SHORT_LABELS[type]).toBeTypeOf("string");
      expect(SHORT_LABELS[type].length).toBeGreaterThan(0);
    }
  });
});

describe("CPU_WIN_LABELS", () => {
  it("全 ForcedWinType に対応するラベルがある", () => {
    for (const type of ALL_FORCED_WIN_TYPES) {
      expect(CPU_WIN_LABELS[type]).toBeTypeOf("string");
      expect(CPU_WIN_LABELS[type].length).toBeGreaterThan(0);
    }
  });

  it("全ラベルが「中」で終わる", () => {
    for (const type of ALL_FORCED_WIN_TYPES) {
      expect(CPU_WIN_LABELS[type]).toMatch(/中$/);
    }
  });
});
