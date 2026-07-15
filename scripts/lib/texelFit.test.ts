/**
 * scripts/lib/texelFit.ts のユニットテスト。
 *
 * docs/plans/prospect-texel-p3-2026-07-15.md（P3-c）:
 * - fitLogistic: 合成データで既知重みを回復できること
 * - groupKFold: 対局（グループ）単位で train/val がまたがらないこと
 * - 決定性: 同一入力から常に同一出力
 */
import { describe, expect, it } from "vitest";

import {
  createSeededRandom,
  fitLogistic,
  groupKFold,
  meanSquaredLoss,
  rapfiTeacherLabel,
  sigmoid,
} from "./texelFit.ts";

describe("sigmoid", () => {
  it("z=0 で 0.5 を返す", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 10);
  });

  it("z が大きいほど1に、小さいほど0に近づく（単調増加）", () => {
    expect(sigmoid(10)).toBeGreaterThan(0.999);
    expect(sigmoid(-10)).toBeLessThan(0.001);
    expect(sigmoid(-1)).toBeLessThan(sigmoid(0));
    expect(sigmoid(0)).toBeLessThan(sigmoid(1));
  });
});

describe("rapfiTeacherLabel", () => {
  it("sigmoid(eval/K) と一致する", () => {
    expect(rapfiTeacherLabel(200, 200)).toBeCloseTo(sigmoid(1), 10);
    expect(rapfiTeacherLabel(0, 200)).toBeCloseTo(0.5, 10);
  });
});

/** 既知重み w_true から合成データを生成する（シード付き擬似乱数、Math.random 不使用）。 */
function buildSyntheticDataset(
  n: number,
  wTrue: number[],
  K: number,
  noiseScale: number,
  seed: number,
): { X: number[][]; labels: number[] } {
  const rng = createSeededRandom(seed);
  const d = wTrue.length;
  const X: number[][] = [];
  const labels: number[] = [];
  for (let i = 0; i < n; i++) {
    // カテゴリ計数を模した特徴（0〜数百のオーダー、正負混在）。
    const row: number[] = [];
    for (let j = 0; j < d; j++) {
      row.push(Math.round((rng() - 0.5) * 20));
    }
    const z = row.reduce((s, v, j) => s + v * wTrue[j]!, 0) / K;
    const noise = (rng() - 0.5) * noiseScale;
    X.push(row);
    labels.push(sigmoid(z + noise));
  }
  return { X, labels };
}

describe("fitLogistic", () => {
  it("合成データから既知重みを回復する（符号一致・低い検証損失）", () => {
    const K = 200;
    const wTrue = [50, -30, 10, 0, 5];
    const { X, labels } = buildSyntheticDataset(800, wTrue, K, 0.02, 1);

    const result = fitLogistic(X, labels, K);

    expect(result.trainLoss).toBeLessThan(0.01);

    // 符号が非ゼロ真値と一致すること（w_true[3]=0 は符号判定の対象外）。
    for (let j = 0; j < wTrue.length; j++) {
      if (wTrue[j] === 0) {
        continue;
      }
      expect(Math.sign(result.weights[j]!)).toBe(Math.sign(wTrue[j]!));
    }

    // 相対順序（絶対値の大小関係）が保たれること。
    expect(Math.abs(result.weights[0]!)).toBeGreaterThan(
      Math.abs(result.weights[2]!),
    );
    expect(Math.abs(result.weights[2]!)).toBeGreaterThan(
      Math.abs(result.weights[4]!),
    );
  });

  it("独立に検証用データでも損失が低い（過学習していない）", () => {
    const K = 200;
    const wTrue = [40, -20, 15, -5];
    const { X: trainX, labels: trainY } = buildSyntheticDataset(
      500,
      wTrue,
      K,
      0.02,
      2,
    );
    const { X: valX, labels: valY } = buildSyntheticDataset(
      200,
      wTrue,
      K,
      0.02,
      3,
    );

    const result = fitLogistic(trainX, trainY, K);
    const valLoss = meanSquaredLoss(valX, valY, result.weights, K);

    expect(valLoss).toBeLessThan(0.01);
  });

  it("定数列（分散ゼロ）があってもクラッシュしない", () => {
    const K = 200;
    const X = [
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    const labels = [0.6, 0.7, 0.8, 0.9];
    const result = fitLogistic(X, labels, K);
    expect(Number.isFinite(result.trainLoss)).toBe(true);
    expect(result.weights.every((w) => Number.isFinite(w))).toBe(true);
  });

  it("同一入力からは常に同一出力を返す（決定性）", () => {
    const K = 200;
    const wTrue = [50, -30, 10];
    const { X, labels } = buildSyntheticDataset(100, wTrue, K, 0.02, 5);

    const first = fitLogistic(X, labels, K);
    const second = fitLogistic(X, labels, K);

    expect(second.weights).toEqual(first.weights);
    expect(second.trainLoss).toBe(first.trainLoss);
    expect(second.iterations).toBe(first.iterations);
  });

  it("最大反復数に達する前に収束する（残っていない場合は打ち切りが機能する）", () => {
    const K = 200;
    const wTrue = [50, -30];
    const { X, labels } = buildSyntheticDataset(300, wTrue, K, 0.01, 6);
    const result = fitLogistic(X, labels, K, { maxIterations: 5000 });
    expect(result.iterations).toBeLessThan(5000);
  });
});

describe("groupKFold", () => {
  const groups = [
    "g1",
    "g1",
    "g1",
    "g2",
    "g2",
    "g3",
    "g3",
    "g3",
    "g3",
    "g4",
    "g5",
    "g5",
  ];

  it("各要素はちょうど1つの fold で val に入る", () => {
    const folds = groupKFold(groups, 5);
    const valCounts = new Array(groups.length).fill(0);
    for (const fold of folds) {
      for (const idx of fold.val) {
        valCounts[idx]++;
      }
    }
    expect(valCounts).toEqual(new Array(groups.length).fill(1));
  });

  it("同一グループの要素は同じ fold 内で train/val に分かれない", () => {
    const folds = groupKFold(groups, 5);
    for (const fold of folds) {
      const valGroups = new Set(fold.val.map((idx) => groups[idx]));
      const trainGroups = new Set(fold.train.map((idx) => groups[idx]));
      for (const g of valGroups) {
        expect(trainGroups.has(g)).toBe(false);
      }
    }
  });

  it("train と val を合わせると全要素数と一致する", () => {
    const folds = groupKFold(groups, 5);
    for (const fold of folds) {
      expect(fold.train.length + fold.val.length).toBe(groups.length);
    }
  });

  it("同一入力からは常に同一分割を返す（決定性）", () => {
    const first = groupKFold(groups, 5);
    const second = groupKFold(groups, 5);
    expect(second).toEqual(first);
  });

  it("グループ数が k 未満なら例外を投げる", () => {
    expect(() => groupKFold(["g1", "g1", "g2"], 5)).toThrow();
  });

  it("k が2未満なら例外を投げる", () => {
    expect(() => groupKFold(groups, 1)).toThrow();
  });
});

describe("meanSquaredLoss", () => {
  it("完全一致なら損失0", () => {
    const w = [0, 0];
    // sigmoid(0)=0.5 なので label=0.5 で完全一致させる
    const loss = meanSquaredLoss([[1, 2]], [0.5], w, 200);
    expect(loss).toBeCloseTo(0, 10);
  });
});
